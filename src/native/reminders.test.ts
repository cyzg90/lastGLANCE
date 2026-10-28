import { describe, it, expect, vi } from 'vitest'

// reminders.ts pulls in the DB and the intents stack at module scope; stub the
// Capacitor surface so the pure helpers can be exercised under node.
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }))

import dayjs from 'dayjs'
import { handleNotificationAction, peopleDescriptor, reminderIdFor, soonest, withinCap } from './reminders'
import type { ReminderTier } from './reminders'
import { clearPendingOpenPerson, OPEN_PERSON_PENDING_EVENT, peekPendingOpenPerson } from './pendingOpenPerson'

describe('reminderIdFor', () => {
  it('is deterministic, so rescheduling replaces an alarm instead of stacking one', () => {
    const id = reminderIdFor('3f2b1c8e-0000-4000-8000-000000000001')
    expect(reminderIdFor('3f2b1c8e-0000-4000-8000-000000000001')).toBe(id)
  })

  it('stays inside the positive 31-bit range both platforms require for ids', () => {
    for (let i = 0; i < 500; i++) {
      const id = reminderIdFor(`chore-${i}-${'x'.repeat(i % 40)}`)
      expect(Number.isInteger(id)).toBe(true)
      expect(id).toBeGreaterThan(0)
      expect(id).toBeLessThanOrEqual(0x7fffffff)
    }
  })

  it('never returns 0, which is not a usable notification id', () => {
    // The `|| 1` fallback exists for inputs that hash to exactly 0.
    expect(reminderIdFor('')).toBe(1)
  })
})

describe('soonest', () => {
  const at = (n: number) => ({ triggerAtMillis: n })

  it('returns the input untouched when it is already within the cap', () => {
    const items = [at(3), at(1), at(2)]
    expect(soonest(items, 5)).toBe(items)
  })

  it('keeps the nearest-firing items when the cap bites', () => {
    const items = [at(500), at(100), at(400), at(200), at(300)]
    expect(soonest(items, 3).map(i => i.triggerAtMillis)).toEqual([100, 200, 300])
  })

  it('does not mutate or reorder the caller array', () => {
    // syncReminders diffs `desired` against the pending set afterwards, so a
    // sort in place here would be an invisible side effect on the caller.
    const items = [at(3), at(1), at(2)]
    soonest(items, 2)
    expect(items.map(i => i.triggerAtMillis)).toEqual([3, 1, 2])
  })

  it('handles an exact-boundary set without dropping anything', () => {
    const items = Array.from({ length: 56 }, (_, i) => at(i))
    expect(soonest(items, 56)).toHaveLength(56)
  })

  it('drops only the furthest-out when one over the cap', () => {
    const items = Array.from({ length: 57 }, (_, i) => at(i))
    const kept = soonest(items, 56)
    expect(kept).toHaveLength(56)
    expect(kept.map(i => i.triggerAtMillis)).not.toContain(56)
  })

  it('copes with an empty set', () => {
    expect(soonest([], 56)).toEqual([])
  })
})

describe('withinCap', () => {
  const r = (tier: ReminderTier, triggerAtMillis: number) => ({ tier, triggerAtMillis })

  it('fills near dates first, then chores, then the digest, then far dates', () => {
    const items = [
      r('far-date', 1), r('digest', 2), r('chore', 30), r('near-date', 40), r('chore', 10), r('near-date', 50),
    ]
    const kept = withinCap(items, 4)
    expect(kept).toHaveLength(4)
    expect(kept).toEqual(expect.arrayContaining([r('near-date', 40), r('near-date', 50), r('chore', 10), r('chore', 30)]))
    expect(withinCap(items, 5)[4]).toEqual(r('digest', 2))
  })

  it('keeps the soonest of a tier when that tier is cut', () => {
    const items = [r('chore', 3), r('chore', 1), r('chore', 2)]
    expect(withinCap(items, 2).map(i => i.triggerAtMillis)).toEqual([1, 2])
  })

  it('returns the input untouched when under the cap', () => {
    const items = [r('digest', 1), r('chore', 2)]
    expect(withinCap(items, 5)).toBe(items)
  })
})

describe('peopleDescriptor', () => {
  const now = dayjs('2026-10-12T15:00:00')

  it('gives a date Log and Open, its own channel, and routing to the person', () => {
    const d = peopleDescriptor({
      kind: 'person-date', key: 'd1:day', personSyncId: 'p1', title: 'Sam', body: 'Birthday today',
      at: now.add(3, 'day'),
    }, now.valueOf())
    expect(d).toMatchObject({
      id: reminderIdFor('d1:day'), tier: 'near-date', channelId: 'people', actionTypeId: 'PERSON_DATE',
      extra: { kind: 'person-date', personSyncId: 'p1' }, dgEnabled: false,
    })
  })

  it('ranks a date past two weeks out below chores', () => {
    const d = peopleDescriptor({
      kind: 'person-date', key: 'd1:day', personSyncId: 'p1', title: 'Sam', body: '', at: now.add(20, 'day'),
    }, now.valueOf())
    expect(d.tier).toBe('far-date')
  })

  it('gives the digest no buttons', () => {
    const d = peopleDescriptor({ kind: 'people-digest', key: 'digest:2026-10-12', title: 't', body: 'b', at: now }, now.valueOf())
    expect(d.tier).toBe('digest')
    expect(d.actionTypeId).toBeUndefined()
    expect(d.extra).toEqual({ kind: 'people-digest' })
  })
})

describe('handleNotificationAction for People', () => {
  it('queues Log, Open and the digest for People to take', () => {
    // Node has no window; an EventTarget stands in for it.
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    const seen: string[] = []
    target.addEventListener(OPEN_PERSON_PENDING_EVENT, () => seen.push('event'))

    handleNotificationAction('log', { kind: 'person-date', personSyncId: 'p1' })
    expect(peekPendingOpenPerson()).toEqual({ action: 'log', personSyncId: 'p1' })
    handleNotificationAction('tap', { kind: 'person-date', personSyncId: 'p1' })
    expect(peekPendingOpenPerson()).toEqual({ action: 'open', personSyncId: 'p1' })
    handleNotificationAction('tap', { kind: 'people-digest' })
    expect(peekPendingOpenPerson()).toEqual({ action: 'home' })

    expect(seen).toHaveLength(3)
    vi.unstubAllGlobals()
    clearPendingOpenPerson()
  })
})
