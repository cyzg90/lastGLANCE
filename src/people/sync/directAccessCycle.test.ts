import { describe, it, expect, vi, afterEach } from 'vitest'
import { RELAY_CONFIRM_MS } from '@glance-apps/sync'
import { runPeopleDirectAccessCycle, peoplePayloadHasData, PEOPLE_LOCAL_MODIFIED_KEY } from './directAccessCycle'
import { LOCAL_MODIFIED_KEY } from '@/sync/directAccessCycle'
import { LOCAL_EDIT_KEY, PEOPLE_LOCAL_EDIT_KEY } from '@/sync/localEditStamp'
import { DIRECT_ACCESS_PEOPLE_LAST_SYNCED_KEY } from '@/sync/directAccess'
import { emptyPeoplePayload } from './types'
import type { PeoplePayload, SyncInteraction, SyncPerson } from './types'

// People's file through Direct Access, two devices over one folder. The cycle
// and People's merge are real, and so is the wiring runPeopleDirectAccessCycle
// adds (the "made here" stamp, the WebDAV hand-off key, what counts as data):
// the test passes only the store, the clock and the device id. The folder is
// one shared string, as a syncing tool keeps it.

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const person = (n: number, name: string, updatedAt: string): SyncPerson => ({
  kind: 'person', id: uuid(n), name, nickname: null, circleSyncId: null, targetCadenceDays: 14,
  preferredChannel: 'call', details: null, archived: false, snoozedUntil: null, ownerUserSyncId: null,
  createdAt: updatedAt, updatedAt,
})
const interaction = (n: number, personN: number, at: string): SyncInteraction => ({
  kind: 'interaction', id: uuid(n), personSyncIds: [uuid(personN)], occurredAt: at, channel: 'call',
  direction: 'outbound', note: null, source: 'manual', updatedAt: at,
})

const memStorage = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, m }
}

function folder() {
  let text: string | null = null
  return {
    get text() { return text },
    transport: (id: string) => ({
      id: `direct-access-people:${id}`,
      lastSyncedKey: DIRECT_ACCESS_PEOPLE_LAST_SYNCED_KEY,
      writeThrottleMs: 0,
      allowsPlaintextReseed: false,
      firstRunDecided: () => true,
      encryptsWrites: () => false,
      read: async () => text,
      write: async (t: string) => { text = t; return true },
    }),
  }
}

function device(name: string) {
  const storage = memStorage()
  let store: PeoplePayload = emptyPeoplePayload()
  let now = Date.parse('2026-10-24T12:00:00.000Z')
  const applyPayload = vi.fn(async (data: unknown) => { store = data as PeoplePayload })
  const iso = () => new Date(now).toISOString()
  return {
    storage,
    applyPayload,
    get store() { return store },
    /** A change made on this device through the People data layer (markPeopleDirty stamps this). */
    edit: (s: PeoplePayload) => { store = s; storage.setItem(PEOPLE_LOCAL_EDIT_KEY, iso()) },
    /** A change that reached this device by another road (the vault, WebDAV): no stamp. */
    receive: (s: PeoplePayload) => { store = s },
    /** A chore edit: the chore stamp only. */
    editChore: () => { storage.setItem(LOCAL_EDIT_KEY, iso()) },
    tick: (ms: number) => { now += ms },
    run: async (transport: ReturnType<ReturnType<typeof folder>['transport']>, state: Parameters<typeof runPeopleDirectAccessCycle>[1] = null) => {
      // The wrapper's defaults read localStorage; this device's storage stands in for it.
      vi.stubGlobal('localStorage', storage)
      return runPeopleDirectAccessCycle({
        transport,
        buildPayload: async () => store as never,
        applyPayload,
        storage,
        deviceId: () => name,
        now: () => now,
        log: { warn: () => {}, error: () => {} },
      }, state)
    },
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('People through Direct Access', () => {
  it('a device with People seeds the file, and a new device picks them up', async () => {
    const f = folder()
    const a = device('a'); const b = device('b')
    a.edit({ ...emptyPeoplePayload(), people: [person(1, 'Maya Chen', '2026-10-24T11:00:00.000Z')] })
    const s1 = await a.run(f.transport('a'))
    expect(s1.outcome).toMatchObject({ kind: 'seeded', wrote: true })
    expect(JSON.parse(f.text!).data.people.map((p: SyncPerson) => p.name)).toEqual(['Maya Chen'])

    const r1 = await b.run(f.transport('b'))
    expect(r1.outcome).toMatchObject({ kind: 'merged', applied: true, wrote: false })
    expect(b.store.people.map((p) => p.name)).toEqual(['Maya Chen'])
    // The apply hands off to People's WebDAV engine, never the chore engine.
    expect(b.storage.getItem(PEOPLE_LOCAL_MODIFIED_KEY)).not.toBeNull()
    expect(b.storage.getItem(LOCAL_MODIFIED_KEY)).toBeNull()
  })

  it('a contact logged on one device goes out at once and lands on the other', async () => {
    const f = folder()
    const a = device('a'); const b = device('b')
    a.edit({ ...emptyPeoplePayload(), people: [person(1, 'Maya Chen', '2026-10-24T11:00:00.000Z')] })
    const s1 = await a.run(f.transport('a'))
    const r1 = await b.run(f.transport('b'))

    b.tick(60_000)
    b.edit({ ...b.store, interactions: [interaction(2, 1, '2026-10-24T12:01:00.000Z')] })
    const r2 = await b.run(f.transport('b'), r1.state)
    expect(r2.outcome).toMatchObject({ kind: 'merged', wrote: true, deferred: false, ownEdits: true })

    a.tick(70_000)
    const s2 = await a.run(f.transport('a'), s1.state)
    expect(s2.outcome).toMatchObject({ kind: 'merged', applied: true })
    expect(a.store.interactions.map((i) => i.id)).toEqual([uuid(2)])
  })

  it('a chore edit is not a People edit: People that arrived by another road wait for the relay', async () => {
    const f = folder()
    const a = device('a')
    a.edit({ ...emptyPeoplePayload(), people: [person(1, 'Maya Chen', '2026-10-24T11:00:00.000Z')] })
    const s0 = await a.run(f.transport('a'))
    a.tick(1000)
    const s1 = await a.run(f.transport('a'), s0.state)

    // The vault delivers a person while the user edits a chore on this device.
    a.tick(5000)
    a.receive({ ...a.store, people: [...a.store.people, person(3, 'Sam Rivera', '2026-10-24T12:00:05.000Z')] })
    a.editChore()
    const s2 = await a.run(f.transport('a'), s1.state)
    expect(s2.outcome).toMatchObject({ kind: 'merged', wrote: false, deferred: true, ownEdits: false })

    a.tick(RELAY_CONFIRM_MS + 1000)
    const s3 = await a.run(f.transport('a'), s2.state)
    expect(s3.outcome).toMatchObject({ wrote: true, deferred: false })
    expect(JSON.parse(f.text!).data.people.map((p: SyncPerson) => p.name).sort()).toEqual(['Maya Chen', 'Sam Rivera'])
  })

  it('a deletion travels as a tombstone and removes the person on the other device', async () => {
    const f = folder()
    const a = device('a'); const b = device('b')
    a.edit({ ...emptyPeoplePayload(), people: [person(1, 'Maya Chen', '2026-10-24T11:00:00.000Z'), person(4, 'Chris Novak', '2026-10-24T11:00:00.000Z')] })
    const s1 = await a.run(f.transport('a'))
    const r1 = await b.run(f.transport('b'))
    expect(b.store.people).toHaveLength(2)

    a.tick(60_000)
    a.edit({ ...a.store, people: a.store.people.filter((p) => p.id !== uuid(4)), tombstones: { [uuid(4)]: '2026-10-24T12:01:00.000Z' } })
    await a.run(f.transport('a'), s1.state)
    b.tick(70_000)
    await b.run(f.transport('b'), r1.state)
    expect(b.store.people.map((p) => p.name)).toEqual(['Maya Chen'])
  })

  it('what counts as People data', () => {
    expect(peoplePayloadHasData(emptyPeoplePayload())).toBe(false)
    expect(peoplePayloadHasData({ ...emptyPeoplePayload(), tombstones: { [uuid(1)]: '2026-10-24T00:00:00.000Z' } })).toBe(false)
    expect(peoplePayloadHasData({ ...emptyPeoplePayload(), personCircles: [{}] })).toBe(true)
    expect(peoplePayloadHasData({ chores: [{}] })).toBe(false)   // a chore payload is not People
    expect(peoplePayloadHasData(null)).toBe(false)
  })
})
