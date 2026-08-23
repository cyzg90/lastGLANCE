import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import { db } from '@/db/client'
import { mergePayloads, applyPayload } from './engine'
import { applyRemoteEntity, getEntityLastModified, getLocalEntity } from './dbEngine'
import type { SyncPayload, SyncCompletionEvent } from './types'
import type { Category, Chore, CompletionEvent } from '@/types'

// Completion-note edit propagation (the "some completion notes aren't syncing"
// bug). Events used to be strictly insert-only on BOTH tiers: a device that
// already held an event skipped every later copy, so an edited note only ever
// reached devices that had never seen the completion. Notes now travel
// last-write-wins on updatedAt (falling back to completedAt for rows/payloads
// from before the field existed).

// Minimal shims for the node test environment.
function installGlobals(): void {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  } as Storage
  ;(globalThis as { window?: unknown }).window = globalThis
  if (!('dispatchEvent' in globalThis)) {
    ;(globalThis as Record<string, unknown>).dispatchEvent = () => true
  }
}
installGlobals()

const CAT_ID = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'
const CHORE_ID = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'
const EVENT_ID = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'
const COMPLETED_AT = '2026-08-01T10:00:00.000Z'
const EDITED_AT = '2026-08-02T09:00:00.000Z'
const LATER_EDIT_AT = '2026-08-03T09:00:00.000Z'

const baseEvent: SyncCompletionEvent = {
  id: EVENT_ID,
  choreSyncId: CHORE_ID,
  completedAt: COMPLETED_AT,
  note: null,
  source: 'manual',
  completedByUserSyncId: null,
}

function payloadWith(events: SyncCompletionEvent[]): SyncPayload {
  return {
    categories: [],
    chores: [],
    completionEvents: events,
    users: [],
    settings: { multiUserEnabled: false },
    tombstones: {},
  }
}

// ── File tier: mergePayloads ─────────────────────────────────────────────────

describe('mergePayloads – note edits win on updatedAt', () => {
  it('remote note edit (newer updatedAt) beats the untouched local copy', () => {
    const local = payloadWith([{ ...baseEvent }])
    const remote = payloadWith([{ ...baseEvent, note: 'used the new filter', updatedAt: EDITED_AT }])

    const { data, localChanged } = mergePayloads(local, remote)
    const merged = (data as SyncPayload).completionEvents
    expect(merged).toHaveLength(1)
    expect(merged[0].note).toBe('used the new filter')
    expect(merged[0].updatedAt).toBe(EDITED_AT)
    expect(localChanged).toBe(true)
  })

  it('local note edit survives a remote copy from an old client with no updatedAt', () => {
    // Old clients re-list the event with only completedAt; the normalizer fills
    // updatedAt = completedAt, so the local edit (strictly newer) wins.
    const local = payloadWith([{ ...baseEvent, note: 'edited locally', updatedAt: EDITED_AT }])
    const remote = payloadWith([{ ...baseEvent }])

    const { data, remoteChanged } = mergePayloads(local, remote)
    const merged = (data as SyncPayload).completionEvents
    expect(merged[0].note).toBe('edited locally')
    expect(remoteChanged).toBe(true)
  })

  it('when both sides edited, the later edit wins', () => {
    const local = payloadWith([{ ...baseEvent, note: 'first edit', updatedAt: EDITED_AT }])
    const remote = payloadWith([{ ...baseEvent, note: 'second edit', updatedAt: LATER_EDIT_AT }])

    const { data } = mergePayloads(local, remote)
    expect((data as SyncPayload).completionEvents[0].note).toBe('second edit')
  })

  it('identical unedited copies still collapse to one and keep local (tie)', () => {
    const local = payloadWith([{ ...baseEvent }])
    const remote = payloadWith([{ ...baseEvent }])

    const { data, localChanged, remoteChanged } = mergePayloads(local, remote)
    expect((data as SyncPayload).completionEvents).toHaveLength(1)
    expect(localChanged).toBe(false)
    expect(remoteChanged).toBe(false)
  })
})

// ── Shared Dexie fixture for the apply-path tests ────────────────────────────

let choreDexieId = 0

beforeAll(async () => {
  const catKey = await db.categories.add({
    name: 'Kitchen', sort_order: 0, icon: 'Fork', sync_id: CAT_ID,
    parent_sync_id: null, assigned_user_sync_ids: [], updated_at: '2026-07-01T00:00:00.000Z',
  } as unknown as Category)
  choreDexieId = await db.chores.add({
    name: 'Descale kettle', category_id: catKey as number, category_sync_id: CAT_ID,
    sort_order: 0, target_cadence_days: 30, notify_when_overdue: false,
    auto_schedule_to_dayglance: false, preferred_schedule_behavior: null,
    seasonal_start: null, seasonal_end: null, icon: 'Coffee', assigned_user_sync_ids: [],
    created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
    sync_id: CHORE_ID,
  } as unknown as Chore) as number
  // The event as written by a build that predates updated_at.
  await db.completionEvents.add({
    chore_id: choreDexieId, completed_at: COMPLETED_AT,
    note: null, source: 'manual', completed_by_user_sync_id: null, sync_id: EVENT_ID,
  } as unknown as CompletionEvent)
})

async function localEvent(): Promise<CompletionEvent> {
  return (await db.completionEvents.where('sync_id').equals(EVENT_ID).first())!
}

// ── File tier: applyPayload on an already-present event ──────────────────────

describe('applyPayload – updates the note on an event it already holds', () => {
  it('adopts an incoming note with a newer updatedAt', async () => {
    await applyPayload(payloadWith([
      { ...baseEvent, note: 'synced edit', updatedAt: EDITED_AT },
    ]), { allowEmpty: false })

    const row = await localEvent()
    expect(row.note).toBe('synced edit')
    expect(row.updated_at).toBe(EDITED_AT)
    // completed_at is untouched: only the note is mutable.
    expect(row.completed_at).toBe(COMPLETED_AT)
  })

  it('keeps the local note when the incoming copy is not newer', async () => {
    await applyPayload(payloadWith([
      { ...baseEvent, note: 'stale copy from an old client' },  // no updatedAt → completedAt
    ]), { allowEmpty: false })

    const row = await localEvent()
    expect(row.note).toBe('synced edit')
    expect(row.updated_at).toBe(EDITED_AT)
  })
})

// ── Vault tier: applyRemoteEntity on an already-present event ────────────────

describe('vault applyRemoteEntity – note last-write-wins', () => {
  it('adopts an incoming note with a newer updatedAt', async () => {
    await applyRemoteEntity(EVENT_ID, {
      ...baseEvent, note: 'vault edit', updatedAt: LATER_EDIT_AT,
    })
    const row = await localEvent()
    expect(row.note).toBe('vault edit')
    expect(row.updated_at).toBe(LATER_EDIT_AT)
  })

  it('keeps the local note against an older incoming copy', async () => {
    await applyRemoteEntity(EVENT_ID, {
      ...baseEvent, note: 'out-of-date', updatedAt: EDITED_AT,
    })
    const row = await localEvent()
    expect(row.note).toBe('vault edit')
    expect(row.updated_at).toBe(LATER_EDIT_AT)
  })

  it('round-trips updatedAt out through getLocalEntity for the next push', async () => {
    const out = await getLocalEntity(EVENT_ID) as Record<string, unknown>
    expect(out.updatedAt).toBe(LATER_EDIT_AT)
    expect(out.note).toBe('vault edit')
  })
})

describe('getEntityLastModified – events prefer updatedAt', () => {
  it('returns updatedAt when present, completedAt otherwise', () => {
    expect(getEntityLastModified({ ...baseEvent, updatedAt: EDITED_AT })).toBe(EDITED_AT)
    expect(getEntityLastModified({ ...baseEvent })).toBe(COMPLETED_AT)
  })
})
