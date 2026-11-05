import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import dayjs from 'dayjs'
import { db } from '@/db/client'
import {
  addPersonDate, createCircle, createPerson, deleteCircle, deleteInteraction, deletePerson,
  getContactLinks, getDatesForPerson, getInteractionsForPerson, getPeople, getPerson, logInteraction,
  removeContactLink, setContactLink, updateInteraction, updatePerson,
} from './queries'
import { applyPeoplePayload, buildPeoplePayload } from './sync/fileEngine'
import { PEOPLE_LOCAL_EDIT_KEY, LOCAL_EDIT_KEY } from '@/sync/localEditStamp'

// markPeopleDirty only stamps this device's People edit time without a
// registered People vault engine, and window is guarded, so these run cleanly
// under node.

function installLocalStorage(): void {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  } as Storage
}
installLocalStorage()

beforeEach(async () => {
  await Promise.all([
    db.people.clear(), db.interactions.clear(), db.personDates.clear(),
    db.personCircles.clear(), db.peopleTombstones.clear(), db.contactLinks.clear(),
  ])
})

describe('people', () => {
  it('creates a person with defaults and rejects a blank name', async () => {
    const p = await createPerson({ name: '  Sam  ', target_cadence_days: 14 })
    expect(p.name).toBe('Sam')
    expect(p.archived).toBe(false)
    expect(p.owner_user_sync_id).toBeNull()
    expect(p.created_at).toBe(p.updated_at)
    await expect(createPerson({ name: '   ' })).rejects.toThrow('name is required')
  })

  it('measures recency from the last interaction, or from creation when there is none', async () => {
    const sam = await createPerson({ name: 'Sam' })
    const alex = await createPerson({ name: 'Alex' })
    await logInteraction({
      person_sync_ids: [sam.sync_id],
      channel: 'call',
      occurred_at: dayjs().subtract(10, 'day').toISOString(),
    })
    await logInteraction({
      person_sync_ids: [sam.sync_id],
      channel: 'text',
      occurred_at: dayjs().subtract(3, 'day').toISOString(),
    })

    const people = await getPeople()
    const s = people.find(p => p.sync_id === sam.sync_id)!
    const a = people.find(p => p.sync_id === alex.sync_id)!
    expect(s.last_channel).toBe('text')
    expect(s.elapsed_days).toBeCloseTo(3, 0)
    expect(a.last_interaction_at).toBeNull()
    expect(a.elapsed_days).toBeLessThan(0.1)
  })

  it('hides archived people unless asked', async () => {
    const p = await createPerson({ name: 'Old friend' })
    await updatePerson(p.sync_id, { archived: true })
    expect(await getPeople()).toHaveLength(0)
    expect(await getPeople({ includeArchived: true })).toHaveLength(1)
  })
})

describe('interactions', () => {
  it('logs one interaction for several people and clears their snooze', async () => {
    const a = await createPerson({ name: 'A' })
    const b = await createPerson({ name: 'B' })
    await updatePerson(a.sync_id, { snoozed_until: dayjs().add(7, 'day').toISOString() })

    const i = await logInteraction({ person_sync_ids: [a.sync_id, b.sync_id, a.sync_id], channel: 'in_person' })
    expect(i.person_sync_ids).toEqual([a.sync_id, b.sync_id])
    expect((await getInteractionsForPerson(b.sync_id)).map(x => x.sync_id)).toEqual([i.sync_id])
    expect((await getPerson(a.sync_id))!.snoozed_until).toBeNull()
  })

  it('stores direction as given, or an explicit null, and reports the latest on the person', async () => {
    const a = await createPerson({ name: 'A' })
    const skipped = await logInteraction({ person_sync_ids: [a.sync_id], channel: 'call', occurred_at: dayjs().subtract(2, 'day').toISOString() })
    expect(await db.interactions.where('sync_id').equals(skipped.sync_id).first()).toHaveProperty('direction', null)
    expect((await getPeople())[0].last_direction).toBeNull()

    const i = await logInteraction({ person_sync_ids: [a.sync_id], channel: 'call', direction: 'inbound' })
    expect((await getPeople())[0].last_direction).toBe('inbound')
    await updateInteraction(i.sync_id, { direction: 'mutual' })
    expect((await getPeople())[0].last_direction).toBe('mutual')
  })

  it('refuses an interaction with nobody in it', async () => {
    await expect(logInteraction({ person_sync_ids: [], channel: 'call' })).rejects.toThrow()
    const a = await createPerson({ name: 'A' })
    const i = await logInteraction({ person_sync_ids: [a.sync_id], channel: 'call' })
    await expect(updateInteraction(i.sync_id, { person_sync_ids: [] })).rejects.toThrow()
  })

  it('tombstones a deleted interaction', async () => {
    const a = await createPerson({ name: 'A' })
    const i = await logInteraction({ person_sync_ids: [a.sync_id], channel: 'email' })
    await deleteInteraction(i.sync_id)
    expect(await db.interactions.count()).toBe(0)
    expect(await db.peopleTombstones.get(i.sync_id)).toBeDefined()
  })
})

describe('deleting a person', () => {
  it('removes their dates and solo interactions but keeps shared ones for the others', async () => {
    const a = await createPerson({ name: 'A' })
    const b = await createPerson({ name: 'B' })
    const solo = await logInteraction({ person_sync_ids: [a.sync_id], channel: 'call' })
    const shared = await logInteraction({ person_sync_ids: [a.sync_id, b.sync_id], channel: 'in_person' })
    const bday = await addPersonDate({ person_sync_id: a.sync_id, kind: 'birthday', month: 5, day: 2 })
    await db.contactLinks.put({ person_sync_id: a.sync_id, device_contact_key: 'k', last_synced_at: dayjs().toISOString() })

    await deletePerson(a.sync_id)

    expect(await getPerson(a.sync_id)).toBeUndefined()
    expect(await db.interactions.where('sync_id').equals(solo.sync_id).first()).toBeUndefined()
    const kept = await db.interactions.where('sync_id').equals(shared.sync_id).first()
    expect(kept!.person_sync_ids).toEqual([b.sync_id])
    expect(await getDatesForPerson(a.sync_id)).toHaveLength(0)
    expect(await db.contactLinks.get(a.sync_id)).toBeUndefined()
    for (const id of [a.sync_id, solo.sync_id, bday.sync_id]) {
      expect(await db.peopleTombstones.get(id)).toBeDefined()
    }
    expect(await db.peopleTombstones.get(shared.sync_id)).toBeUndefined()
  })
})

describe('dates', () => {
  it('validates month and day, allowing Feb 29 and an unknown year', async () => {
    const a = await createPerson({ name: 'A' })
    const leap = await addPersonDate({ person_sync_id: a.sync_id, kind: 'birthday', month: 2, day: 29 })
    expect(leap.year).toBeNull()
    await expect(addPersonDate({ person_sync_id: a.sync_id, kind: 'custom', month: 4, day: 31 })).rejects.toThrow('invalid day')
    await expect(addPersonDate({ person_sync_id: a.sync_id, kind: 'custom', month: 13, day: 1 })).rejects.toThrow('invalid month')
  })
})

describe('circles', () => {
  it('deleting a circle leaves its members ungrouped', async () => {
    const family = await createCircle('Family')
    const a = await createPerson({ name: 'A', circle_sync_id: family.sync_id })
    await deleteCircle(family.sync_id)
    expect((await getPerson(a.sync_id))!.circle_sync_id).toBeNull()
    expect(await db.peopleTombstones.get(family.sync_id)).toBeDefined()
  })
})

describe('contact links', () => {
  it('sets, moves and removes a device-local link', async () => {
    const a = await createPerson({ name: 'Ana' })
    await setContactLink(a.sync_id, 'look/1')
    await setContactLink(a.sync_id, 'look/2')
    expect((await getContactLinks()).map(l => [l.person_sync_id, l.device_contact_key])).toEqual([[a.sync_id, 'look/2']])
    await removeContactLink(a.sync_id)
    expect(await getContactLinks()).toEqual([])
    expect(await getPerson(a.sync_id)).toBeDefined()
  })
})

describe('the People "edited here" stamp (Direct Access People file)', () => {
  it('every write of the data layer stamps it; an apply from sync never does; chores are untouched', async () => {
    localStorage.removeItem(PEOPLE_LOCAL_EDIT_KEY)
    localStorage.removeItem(LOCAL_EDIT_KEY)
    const p = await createPerson({ name: 'Maya' })
    const first = localStorage.getItem(PEOPLE_LOCAL_EDIT_KEY)
    expect(first).not.toBeNull()
    expect(localStorage.getItem(LOCAL_EDIT_KEY)).toBeNull()

    localStorage.removeItem(PEOPLE_LOCAL_EDIT_KEY)
    await logInteraction({ person_sync_ids: [p.sync_id], channel: 'call' })
    expect(localStorage.getItem(PEOPLE_LOCAL_EDIT_KEY)).not.toBeNull()

    // A payload arriving from another device (any transport's apply).
    const payload = await buildPeoplePayload()
    await db.people.clear(); await db.interactions.clear()
    localStorage.removeItem(PEOPLE_LOCAL_EDIT_KEY)
    await applyPeoplePayload(payload, { allowEmpty: false })
    expect((await getPeople()).map(x => x.name)).toEqual(['Maya'])
    expect(localStorage.getItem(PEOPLE_LOCAL_EDIT_KEY)).toBeNull()
  })
})
