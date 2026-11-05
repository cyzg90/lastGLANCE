import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  handleLauncherIntent, recordHandled, readLauncherLedger, writeLauncherLedger,
  LAUNCHER_LEDGER_LIMIT, LG_LAUNCHER_ACTIONS, type HandledWrite,
} from './launcherWrites'
import type { IntentChore, IntentContext } from './handleIntent'
import type { Person } from '@/people/types'

function fakeContext() {
  const chores: IntentChore[] = [
    { id: 1, sync_id: 'chore-1', name: 'Vacuum', category_id: 1, target_cadence_days: 7, elapsed_days: 4 },
    { id: 2, sync_id: 'chore-2', name: 'Mow', category_id: 1, target_cadence_days: 14, elapsed_days: 20 },
  ]
  const people: Person[] = [{
    sync_id: 'p1', name: 'Ana', nickname: null, circle_sync_id: null, target_cadence_days: 30, preferred_channel: 'call',
    details: null, archived: false, snoozed_until: null, owner_user_sync_id: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  }]
  const logged = new Set<string>()
  let nextId = 3
  const ctx: IntentContext = {
    listChores: vi.fn(async () => chores),
    ensureCategory: vi.fn(async () => 1),
    createChore: vi.fn(async ({ name }) => {
      const id = nextId++
      chores.push({ id, sync_id: `chore-${id}`, name, category_id: 1, target_cadence_days: null, elapsed_days: null })
      return { id, sync_id: `chore-${id}` }
    }),
    logCompletion: vi.fn(async () => {}),
    onChoreCompleted: vi.fn(),
    listPeople: vi.fn(async () => people),
    interactionExists: vi.fn(async (id: string) => logged.has(id)),
    logInteraction: vi.fn(async (input) => {
      const sync_id = input.sync_id ?? 'generated'
      logged.add(sync_id)
      return { sync_id }
    }),
  }
  return ctx
}

function io() {
  let ledger: HandledWrite[] = []
  return {
    get ledger() { return ledger },
    io: { get ledger() { return ledger }, persist: (next: HandledWrite[]) => { ledger = next } },
  }
}

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
})

describe('handleLauncherIntent', () => {
  it('requires a client id and a launcher action', async () => {
    const ctx = fakeContext()
    expect(await handleLauncherIntent({ action: LG_LAUNCHER_ACTIONS.COMPLETE, payload: { chore_id: 'chore-1' } }, ctx, io().io))
      .toEqual({ success: false, error: 'clientId required' })
    expect((await handleLauncherIntent({ action: 'app.lastglance.COMPLETE', clientId: 'w1' }, ctx, io().io)).success).toBe(false)
    expect(ctx.logCompletion).not.toHaveBeenCalled()
  })

  it('completes a chore by id once, and acknowledges the same id again without logging twice', async () => {
    const ctx = fakeContext()
    const state = io()
    const write = { action: LG_LAUNCHER_ACTIONS.COMPLETE, payload: { chore_id: 'chore-2', completed_at: '2026-10-19T14:00:00.000Z' }, clientId: 'w-done' }
    expect(await handleLauncherIntent(write, ctx, state.io)).toEqual({ success: true, chore_id: 'chore-2' })
    expect(ctx.logCompletion).toHaveBeenCalledWith(2, '2026-10-19T14:00:00.000Z')
    expect(ctx.onChoreCompleted).toHaveBeenCalledWith({ sync_id: 'chore-2', name: 'Mow', completedAt: '2026-10-19T14:00:00.000Z' })
    expect(state.ledger).toEqual([expect.objectContaining({ clientId: 'w-done', action: 'complete', entityId: 'chore-2' })])

    expect(await handleLauncherIntent(write, ctx, state.io)).toEqual({ success: true, deduped: true, chore_id: 'chore-2' })
    expect(ctx.logCompletion).toHaveBeenCalledTimes(1)
  })

  it('fails a complete for an unknown id and records nothing, so the launcher may retry', async () => {
    const ctx = fakeContext()
    const state = io()
    const result = await handleLauncherIntent({ action: LG_LAUNCHER_ACTIONS.COMPLETE, payload: { chore_id: 'nope' }, clientId: 'w-x' }, ctx, state.io)
    expect(result.success).toBe(false)
    expect(state.ledger).toEqual([])
  })

  it('still completes by title when no id is given', async () => {
    const ctx = fakeContext()
    const result = await handleLauncherIntent({ action: LG_LAUNCHER_ACTIONS.COMPLETE, payload: { title: 'vacuum' }, clientId: 'w-t' }, ctx, io().io)
    expect(result).toMatchObject({ success: true, chore_id: 'chore-1' })
    expect(ctx.logCompletion).toHaveBeenCalledWith(1, undefined)
  })

  it('creates a chore and records its id under the client id', async () => {
    const ctx = fakeContext()
    const state = io()
    const write = { action: LG_LAUNCHER_ACTIONS.CREATE, payload: { title: 'Dust' }, clientId: 'w-new' }
    expect(await handleLauncherIntent(write, ctx, state.io)).toEqual({ success: true, chore_id: 'chore-3' })
    expect(state.ledger[0]).toMatchObject({ clientId: 'w-new', action: 'create', entityId: 'chore-3' })
    expect(await handleLauncherIntent(write, ctx, state.io)).toEqual({ success: true, deduped: true, chore_id: 'chore-3' })
    expect(ctx.createChore).toHaveBeenCalledTimes(1)
  })

  it('logs an interaction by person id with the client id as its own id', async () => {
    const ctx = fakeContext()
    const state = io()
    const write = { action: LG_LAUNCHER_ACTIONS.LOG_INTERACTION, payload: { person_id: 'p1', channel: 'text' }, clientId: 'w-log' }
    expect(await handleLauncherIntent(write, ctx, state.io)).toEqual({ success: true, person_id: 'p1', interaction_id: 'w-log' })
    expect(ctx.logInteraction).toHaveBeenCalledWith(expect.objectContaining({ person_sync_ids: ['p1'], channel: 'text', sync_id: 'w-log', source: 'intent' }))
    expect(state.ledger[0]).toMatchObject({ action: 'log_interaction', entityId: 'w-log' })
    // The data layer backs the ledger: with the ledger lost, the interaction's id still stops a second log.
    expect(await handleLauncherIntent(write, ctx, io().io)).toMatchObject({ success: true, interaction_id: 'w-log', warning: expect.stringContaining('Already logged') })
    expect(ctx.logInteraction).toHaveBeenCalledTimes(1)
  })

  it('announces a recorded write', async () => {
    const heard = vi.fn()
    window.addEventListener('lg:launcher-write-handled', heard)
    await handleLauncherIntent({ action: LG_LAUNCHER_ACTIONS.COMPLETE, payload: { chore_id: 'chore-1' }, clientId: 'w-ev' }, fakeContext(), io().io)
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('the ledger', () => {
  it('keeps one entry per client id and stays bounded', () => {
    let ledger: HandledWrite[] = []
    for (let i = 0; i < LAUNCHER_LEDGER_LIMIT + 10; i++) {
      ledger = recordHandled(ledger, { clientId: `w-${i}`, action: 'complete', entityId: null, at: '' })
    }
    expect(ledger).toHaveLength(LAUNCHER_LEDGER_LIMIT)
    expect(ledger[0].clientId).toBe('w-10')
    ledger = recordHandled(ledger, { clientId: 'w-20', action: 'create', entityId: 'c', at: '' })
    expect(ledger.filter(h => h.clientId === 'w-20')).toHaveLength(1)
    expect(ledger[ledger.length - 1]).toMatchObject({ clientId: 'w-20', action: 'create' })
  })

  it('reads an empty ledger from no storage or bad storage', () => {
    expect(readLauncherLedger(undefined)).toEqual([])
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
    storage.setItem('lg_launcher_handled', '{not json')
    expect(readLauncherLedger(storage)).toEqual([])
    writeLauncherLedger([{ clientId: 'a', action: 'create', entityId: null, at: '' }], storage)
    expect(readLauncherLedger(storage)).toEqual([{ clientId: 'a', action: 'create', entityId: null, at: '' }])
  })
})

describe('REFRESH', () => {
  const write = (clientId: string) => ({ action: LG_LAUNCHER_ACTIONS.REFRESH, payload: {}, clientId })

  it('runs every road, re-stamps the heartbeat, records the outcome, and never touches the ledger', async () => {
    const calls: string[] = []
    const recorded: unknown[] = []
    const state = io()
    const hooks = {
      runSyncCycle: async () => { calls.push('sync') },
      touchHeartbeat: () => { calls.push('heartbeat') },
      record: (r: unknown) => { recorded.push(r) },
    }
    expect(await handleLauncherIntent(write('rf-1'), fakeContext(), state.io, hooks)).toMatchObject({ success: true })
    expect(calls).toEqual(['sync', 'heartbeat'])
    expect(recorded).toEqual([expect.objectContaining({ clientId: 'rf-1', outcome: 'ran' })])
    expect(state.ledger).toEqual([])
    expect(await handleLauncherIntent(write('rf-1'), fakeContext(), state.io, hooks)).toMatchObject({ success: true, deduped: true })
    expect(calls).toEqual(['sync', 'heartbeat'])
  })

  it('records a failure with its reason and still re-stamps the heartbeat', async () => {
    const recorded: Array<{ outcome: string; reason?: string }> = []
    let touched = 0
    const hooks = {
      runSyncCycle: async () => { throw new Error('vault 503') },
      touchHeartbeat: () => { touched++ },
      record: (r: { outcome: string; reason?: string }) => { recorded.push(r) },
    }
    expect(await handleLauncherIntent(write('rf-2'), fakeContext(), io().io, hooks)).toMatchObject({ success: false, error: 'vault 503' })
    expect(recorded[0]).toMatchObject({ outcome: 'failed', reason: 'vault 503' })
    expect(touched).toBe(1)
    const rec2: Array<{ outcome: string; reason?: string }> = []
    expect(await handleLauncherIntent(write('rf-3'), fakeContext(), io().io, { record: (r) => { rec2.push(r) } })).toMatchObject({ success: false })
    expect(rec2[0]).toMatchObject({ outcome: 'failed', reason: 'no sync cycle available' })
  })
})
