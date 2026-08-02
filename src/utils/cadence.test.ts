import { describe, it, expect } from 'vitest'
import { isPastCadence } from './cadence'

// The single overdue definition shared by the overdue toast, the toast
// reconciler, and the dayGLANCE auto-schedule. The null/undefined cases encode
// real states: no cadence configured, and never-completed (elapsed null) —
// neither may ever count as overdue, or a fresh chore would toast on creation.
describe('isPastCadence', () => {
  it('is false without a cadence', () => {
    expect(isPastCadence(null, 10)).toBe(false)
    expect(isPastCadence(undefined, 10)).toBe(false)
    expect(isPastCadence(0, 10)).toBe(false)
  })

  it('is false for a never-completed chore (elapsed null)', () => {
    expect(isPastCadence(7, null)).toBe(false)
    expect(isPastCadence(7, undefined)).toBe(false)
  })

  it('is false while within cadence', () => {
    expect(isPastCadence(7, 0)).toBe(false)
    expect(isPastCadence(7, 6.9)).toBe(false)
  })

  it('is true at and past the cadence boundary', () => {
    expect(isPastCadence(7, 7)).toBe(true)
    expect(isPastCadence(7, 30)).toBe(true)
    expect(isPastCadence(1, 1)).toBe(true)
  })
})
