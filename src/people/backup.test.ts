import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { db } from '@/db/client'
import { createCategory, exportBackup, restoreFromBackup } from '@/db/queries'
import { createPerson, logInteraction, deletePerson } from './queries'
import { buildFullBackupPayload, buildPayload } from '@/sync/engine'
import { registerPeopleFileSyncRunner } from './sync/dirtyTracker'

beforeEach(async () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  })
  await Promise.all(db.tables.map(table => table.clear()))
})

afterEach(() => {
  registerPeopleFileSyncRunner(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('People in full backups', () => {
  it('restores a People-only export and tombstones people omitted by the snapshot', async () => {
    const person = await createPerson({ name: 'Sam' })
    await logInteraction({ person_sync_ids: [person.sync_id], channel: 'call' })
    const backup = await exportBackup()
    expect(backup.version).toBe(3)
    const other = await createPerson({ name: 'Alex' })
    await restoreFromBackup(backup)
    expect((await db.people.toArray()).map(p => p.name)).toEqual(['Sam'])
    expect(await db.interactions.count()).toBe(1)
    expect(await db.peopleTombstones.get(other.sync_id)).toBeDefined()
    expect((await db.people.toArray())[0].updated_at >= person.updated_at).toBe(true)
  })

  it('keeps People when restoring a legacy backup', async () => {
    await createCategory('Home')
    const legacy = await exportBackup()
    delete legacy.peopleData
    await createPerson({ name: 'Sam' })
    await restoreFromBackup(legacy)
    expect(await db.people.count()).toBe(1)
  })

  it('backs up People remotely without putting them in the task sync file', async () => {
    await createPerson({ name: 'Sam' })
    expect((await buildFullBackupPayload()).peopleData.people).toHaveLength(1)
    expect(await buildPayload()).not.toHaveProperty('peopleData')
  })

  it('rejects malformed People before replacing any task data', async () => {
    await createCategory('Home')
    const backup = await exportBackup()
    await expect(restoreFromBackup({ ...backup, peopleData: { people: [] } })).rejects.toThrow()
    expect(await db.categories.count()).toBe(1)
  })

  it('restores an explicitly empty People snapshot and retains its deletions', async () => {
    await createCategory('Home')
    const backup = await exportBackup()
    const person = await createPerson({ name: 'Sam' })
    await restoreFromBackup(backup)
    expect(await db.people.count()).toBe(0)
    expect(await db.peopleTombstones.get(person.sync_id)).toBeDefined()
  })

  it('keeps deletion history from a backup so deleted people cannot sync back', async () => {
    await createCategory('Home')
    const person = await createPerson({ name: 'Sam' })
    await deletePerson(person.sync_id)
    const backup = await exportBackup()
    await db.peopleTombstones.clear()
    await restoreFromBackup(backup)
    expect(await db.peopleTombstones.get(person.sync_id)).toBeDefined()
  })

  it('debounces People writes and deletions without a vault engine', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const sync = vi.fn(async () => {})
    registerPeopleFileSyncRunner(sync)
    const person = await createPerson({ name: 'Sam' })
    await deletePerson(person.sync_id)
    expect(sync).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sync).toHaveBeenCalledTimes(1)
  })
})
