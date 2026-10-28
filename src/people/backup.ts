import { db } from '@/db/client'
import { PEOPLE_TABLES, notifyPeopleApplied, upsertPeopleEntity } from './sync/apply'
import { markPeopleDirty } from './sync/dirtyTracker'
import { invalidReason, uuidRe, type PeoplePayload, type SyncPeopleEntity } from './sync/types'

const KEYS = ['people', 'interactions', 'personDates', 'personCircles'] as const

export function validatePeopleBackup(raw: unknown): asserts raw is PeoplePayload {
  if (!raw || typeof raw !== 'object') throw new Error('invalid People backup')
  const data = raw as PeoplePayload
  if (!data.tombstones || typeof data.tombstones !== 'object' || Array.isArray(data.tombstones)) throw new Error('invalid People tombstones')
  for (const [id, stamp] of Object.entries(data.tombstones)) {
    if (!uuidRe.test(id) || typeof stamp !== 'string' || !Number.isFinite(Date.parse(stamp))) throw new Error('invalid People tombstone')
  }
  const ids = new Set<string>()
  const kinds = ['person', 'interaction', 'personDate', 'personCircle']
  KEYS.forEach((key, index) => {
    if (!Array.isArray(data[key])) throw new Error('invalid People backup tables')
    for (const entity of data[key]) {
      if (invalidReason(entity) || entity.kind !== kinds[index] || ids.has(entity.id)) {
        throw new Error('invalid People backup entity')
      }
      ids.add(entity.id)
    }
  })
}

// Called inside the encompassing restore transaction. Fresh timestamps and
// tombstones make this snapshot authoritative on the next sync.
export async function restorePeopleBackup(data: PeoplePayload, now: string): Promise<string[]> {
  const tables = PEOPLE_TABLES()
  const existing = (await Promise.all([db.people.toArray(), db.interactions.toArray(), db.personDates.toArray(), db.personCircles.toArray()])).flat()
  const entities: SyncPeopleEntity[] = [...data.people, ...data.interactions, ...data.personDates, ...data.personCircles]
  const restored = new Set(entities.map(entity => entity.id))
  const oldTombstones = await db.peopleTombstones.toArray()
  await Promise.all(tables.map(table => table.clear()))
  for (const entity of entities) await upsertPeopleEntity({ ...entity, updatedAt: now })
  const removed = [...new Set([
    ...existing.map(row => row.sync_id),
    ...oldTombstones.map(row => row.id),
    ...Object.keys(data.tombstones),
  ])].filter(id => !restored.has(id))
  await db.peopleTombstones.bulkPut(removed.map(id => ({ id, deleted_at: now })))
  // Device-specific links are retained only for people still in the snapshot.
  const peopleIds = new Set(data.people.map(person => person.id))
  await db.contactLinks.filter(link => !peopleIds.has(link.person_sync_id)).delete()
  return [...restored, ...removed]
}

export function notifyPeopleRestored(ids: string[]): void {
  for (const id of ids) markPeopleDirty(id)
  notifyPeopleApplied()
}
