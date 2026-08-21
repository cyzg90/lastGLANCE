import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerFileSyncRunner, scheduleFileSync } from './fileSyncScheduler'

describe('fileSyncScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    registerFileSyncRunner(null)
    vi.useRealTimers()
  })

  it('runs once after the one-second debounce window', () => {
    let cycles = 0
    registerFileSyncRunner(async () => { cycles++ })

    scheduleFileSync()
    vi.advanceTimersByTime(999)
    expect(cycles).toBe(0)
    vi.advanceTimersByTime(1)
    expect(cycles).toBe(1)
  })

  it('collapses a burst of dirty marks into one cycle', () => {
    let cycles = 0
    registerFileSyncRunner(async () => { cycles++ })

    scheduleFileSync()
    vi.advanceTimersByTime(500)
    scheduleFileSync()
    vi.advanceTimersByTime(500)
    scheduleFileSync()
    vi.advanceTimersByTime(999)
    expect(cycles).toBe(0)
    vi.advanceTimersByTime(1)
    expect(cycles).toBe(1)
  })

  it('cancels pending work when the runner is detached', () => {
    let cycles = 0
    registerFileSyncRunner(async () => { cycles++ })
    scheduleFileSync()

    registerFileSyncRunner(null)
    vi.advanceTimersByTime(1000)
    expect(cycles).toBe(0)
  })
})
