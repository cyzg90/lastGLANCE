import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { db } from './client'

afterEach(async () => { await db.delete() })

describe('managed database upgrade', () => {
  it('creates an empty database without sample records', async () => {
    await db.delete()
    await db.open()
    expect(await db.categories.count()).toBe(0)
    expect(await db.chores.count()).toBe(0)
    expect(await db.people.count()).toBe(0)
  })

  it('adds People tables to a v13 database while preserving existing task data', async () => {
    await db.delete()
    const legacy = new Dexie('lastglance')
    legacy.version(13).stores({
      categories: '++id, sort_order, parent_category_id, sync_id',
      chores: '++id, category_id, sort_order, sync_id',
      completionEvents: '++id, chore_id, completed_at, sync_id',
      tombstones: 'id',
      users: '++id, sync_id',
    })
    await legacy.open()
    await legacy.table('categories').add({ id: 1, name: 'Home', sync_id: 'existing-category' })
    await legacy.table('chores').add({ id: 1, name: 'Water plants', category_id: 1, sync_id: 'existing-chore' })
    legacy.close()
    await db.open()
    expect((await db.chores.get(1))?.name).toBe('Water plants')
    expect((await db.chores.get(1))?.pinned).toBe(false)
    expect((await db.categories.get(1))?.name).toBe('Home')
    expect(await db.people.count()).toBe(0)
    expect(await db.contactLinks.count()).toBe(0)
    expect(db.verno).toBe(15)
  })

  it('upgrades v14 without losing People or an existing pin', async () => {
    await db.delete()
    const legacy = new Dexie('lastglance')
    legacy.version(14).stores({
      categories: '++id, sort_order, parent_category_id, sync_id',
      chores: '++id, category_id, sort_order, sync_id',
      completionEvents: '++id, chore_id, completed_at, sync_id',
      tombstones: 'id',
      users: '++id, sync_id',
      people: '++id, &sync_id, circle_sync_id',
      interactions: '++id, &sync_id, *person_sync_ids, occurred_at',
      personDates: '++id, &sync_id, person_sync_id',
      personCircles: '++id, &sync_id, sort_order',
      peopleTombstones: 'id',
      contactLinks: 'person_sync_id',
    })
    await legacy.open()
    await legacy.table('chores').bulkAdd([
      { id: 1, name: 'Water plants', sync_id: 'old-chore' },
      { id: 2, name: 'Pay bills', sync_id: 'pinned-chore', pinned: true },
    ])
    await legacy.table('people').add({ name: 'Sam', sync_id: 'existing-person' })
    legacy.close()
    await db.open()
    expect((await db.chores.get(1))?.pinned).toBe(false)
    expect((await db.chores.get(2))?.pinned).toBe(true)
    expect((await db.people.toArray())[0].name).toBe('Sam')
    expect(await db.categories.count()).toBe(0)
    expect(db.verno).toBe(15)
  })
})
