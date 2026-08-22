import { describe, it, expect, vi } from 'vitest'

// reminders.ts pulls in the DB and the intents stack at module scope; stub the
// Capacitor surface so the pure helpers can be exercised under node.
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }))

import { reminderIdFor, soonest } from './reminders'

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
