import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/db/client'
import { applyPeoplePayload, buildPeoplePayload, mergePeoplePayloads } from './fileEngine'
import type { PeoplePayload, SyncInteraction, SyncPerson } from './types'
import { emptyPeoplePayload, fromSyncPerson, toSyncPerson } from './types'

const P1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const P2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const I1 = 'bbbbbbbb-0000-4000-8000-000000000001'

function person(id: string, name: string, updatedAt: string): SyncPerson {
  return {
    kind: 'person', id, name, nickname: null, circleSyncId: null, targetCadenceDays: 14,
    preferredChannel: null, details: null, archived: false, snoozedUntil: null, notifyWhenOverdue: false,
    addToDayglanceWhenOverdue: false, sendToLifeglance: false,
    ownerUserSyncId: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt,
  }
}

function interaction(id: string, people: string[], updatedAt: string): SyncInteraction {
  return {
    kind: 'interaction', id, personSyncIds: people, occurredAt: '2026-02-01T12:00:00.000Z',
    channel: 'video', direction: 'inbound', note: null, source: 'manual', updatedAt,
  }
}

function payload(over: Partial<PeoplePayload>): PeoplePayload {
  return { ...emptyPeoplePayload(), ...over }
}

beforeEach(async () => {
  await Promise.all([
    db.people.clear(), db.interactions.clear(), db.personDates.clear(),
    db.personCircles.clear(), db.peopleTombstones.clear(),
  ])
})

describe('mergePeoplePayloads', () => {
  it('keeps the newer copy of each entity and reports which side changed', () => {
    const local = payload({ people: [person(P1, 'Sam (local)', '2026-03-02T00:00:00.000Z')] })
    const remote = payload({
      people: [person(P1, 'Sam (remote)', '2026-03-01T00:00:00.000Z'), person(P2, 'Alex', '2026-03-01T00:00:00.000Z')],
    })
    const { data, localChanged, remoteChanged } = mergePeoplePayloads(local, remote)
    const merged = data as PeoplePayload
    expect(merged.people.map(p => p.name).sort()).toEqual(['Alex', 'Sam (local)'])
    expect(localChanged).toBe(true)   // Alex arrives locally
    expect(remoteChanged).toBe(true)  // the newer Sam goes up
  })

  it('drops an entity a newer tombstone covers, keeps one edited after the delete', () => {
    // Tombstones older than 90 days are pruned, so keep these recent.
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
    const local = payload({
      people: [person(P1, 'Deleted elsewhere', day(5)), person(P2, 'Edited after', day(1))],
    })
    const remote = payload({ tombstones: { [P1]: day(3), [P2]: day(3) } })
    const merged = mergePeoplePayloads(local, remote).data as PeoplePayload
    expect(merged.people.map(p => p.id)).toEqual([P2])
  })

  it('discards malformed rows instead of failing the merge', () => {
    const bad = { ...person(P2, '', '2026-03-01T00:00:00.000Z') }
    const remote = payload({ people: [person(P1, 'Ok', '2026-03-01T00:00:00.000Z'), bad] })
    const merged = mergePeoplePayloads(null, remote).data as PeoplePayload
    expect(merged.people.map(p => p.id)).toEqual([P1])
  })
})

describe('applyPeoplePayload and buildPeoplePayload', () => {
  it('round-trips every table', async () => {
    const remote = payload({
      people: [person(P1, 'Sam', '2026-03-01T00:00:00.000Z')],
      interactions: [interaction(I1, [P1], '2026-03-01T00:00:00.000Z')],
      personDates: [{
        kind: 'personDate', id: 'cccccccc-0000-4000-8000-000000000001', personSyncId: P1,
        dateKind: 'birthday', label: null, month: 7, day: 4, year: 1990, remindDaysBefore: 2,
        updatedAt: '2026-03-01T00:00:00.000Z',
      }],
      personCircles: [{
        kind: 'personCircle', id: 'dddddddd-0000-4000-8000-000000000001', name: 'Family',
        icon: null, sortOrder: 0, updatedAt: '2026-03-01T00:00:00.000Z',
      }],
    })
    await applyPeoplePayload(remote, { allowEmpty: false })
    const built = await buildPeoplePayload()
    expect(built).toEqual(remote)
  })

  it('does not overwrite a newer local row, and removes rows a newer tombstone covers', async () => {
    await applyPeoplePayload(payload({
      people: [person(P1, 'Local newer', '2026-03-05T00:00:00.000Z'), person(P2, 'Doomed', '2026-03-01T00:00:00.000Z')],
    }), { allowEmpty: false })

    await applyPeoplePayload(payload({
      people: [person(P1, 'Remote older', '2026-03-02T00:00:00.000Z')],
      tombstones: { [P2]: '2026-03-03T00:00:00.000Z' },
    }), { allowEmpty: false })

    const rows = await db.people.toArray()
    expect(rows.map(r => r.name)).toEqual(['Local newer'])
    expect(await db.peopleTombstones.get(P2)).toEqual({ id: P2, deleted_at: '2026-03-03T00:00:00.000Z' })
  })

  it('reads a missing or unknown direction as not recorded, and always writes the key', async () => {
    const legacy = { ...interaction(I1, [P1], '2026-03-01T00:00:00.000Z') } as Partial<SyncInteraction>
    delete legacy.direction
    const future = { ...interaction('bbbbbbbb-0000-4000-8000-000000000002', [P1], '2026-03-01T00:00:00.000Z'), direction: 'sideways' }
    await applyPeoplePayload(payload({
      people: [person(P1, 'Sam', '2026-03-01T00:00:00.000Z')],
      interactions: [legacy as SyncInteraction, future as unknown as SyncInteraction],
    }), { allowEmpty: false })
    const built = await buildPeoplePayload()
    expect(built.interactions.map(i => i.direction)).toEqual([null, null])
    expect(JSON.parse(JSON.stringify(built)).interactions[0]).toHaveProperty('direction', null)
  })

  it('ignores an empty payload unless allowed', async () => {
    await applyPeoplePayload(payload({ people: [person(P1, 'Sam', '2026-03-01T00:00:00.000Z')] }), { allowEmpty: false })
    await applyPeoplePayload(payload({ tombstones: { [P1]: '2026-04-01T00:00:00.000Z' } }), { allowEmpty: false })
    expect(await db.people.count()).toBe(1)
    await applyPeoplePayload(payload({ tombstones: { [P1]: '2026-04-01T00:00:00.000Z' } }), { allowEmpty: true })
    expect(await db.people.count()).toBe(0)
  })
})

describe('notifyWhenOverdue on the wire', () => {
  it('reads a person from a build without the field as not notifying', () => {
    const { notifyWhenOverdue: _omit, ...old } = person(P1, 'Old', '2026-01-01T00:00:00.000Z')
    void _omit
    expect(fromSyncPerson(old as SyncPerson).notify_when_overdue).toBe(false)
  })

  it('always writes the field', () => {
    const row = fromSyncPerson({ ...person(P1, 'New', '2026-01-01T00:00:00.000Z'), notifyWhenOverdue: true })
    expect(toSyncPerson(row).notifyWhenOverdue).toBe(true)
    expect(toSyncPerson({ ...row, notify_when_overdue: undefined }).notifyWhenOverdue).toBe(false)
  })
})

describe('GLANCE intent opt-ins on the wire', () => {
  it('reads a person from a build without them as opted out', () => {
    const { addToDayglanceWhenOverdue: _a, sendToLifeglance: _b, ...old } = person(P1, 'Old', '2026-01-01T00:00:00.000Z')
    void _a; void _b
    const row = fromSyncPerson(old as SyncPerson)
    expect(row.add_to_dayglance_when_overdue).toBe(false)
    expect(row.send_to_lifeglance).toBe(false)
  })

  it('round-trips both', () => {
    const row = fromSyncPerson({
      ...person(P1, 'New', '2026-01-01T00:00:00.000Z'), addToDayglanceWhenOverdue: true, sendToLifeglance: true,
    })
    expect(toSyncPerson(row)).toMatchObject({ addToDayglanceWhenOverdue: true, sendToLifeglance: true })
  })
})
