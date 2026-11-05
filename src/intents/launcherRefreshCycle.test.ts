import { afterEach, describe, expect, it, vi } from 'vitest'
import { REFRESH_CAP_MS, runCappedRefreshCycle } from './launcherRefreshCycle'

// The live REFRESH cycle's time limit: a tier that never returns fails the
// refresh after the cap, naming the tiers still running, instead of leaving it
// silent until the native hold marks it unanswered.

const never = () => new Promise<never>(() => {})
const done = () => Promise.resolve()

describe('runCappedRefreshCycle', () => {
  afterEach(() => vi.useRealTimers())

  it('fails after the cap, naming only the tiers still running', async () => {
    vi.useFakeTimers()
    const run = runCappedRefreshCycle([['the chores file sync', done], ['the chores vault sync', never], ['the people vault sync', never]])
    const check = expect(run).rejects.toThrow('timed out after 45 s waiting on the chores vault sync, the people vault sync')
    await vi.advanceTimersByTimeAsync(REFRESH_CAP_MS)
    await check
  })

  it('resolves when every tier does, and leaves no timer behind', async () => {
    vi.useFakeTimers()
    await expect(runCappedRefreshCycle([['a', done], ['b', done]])).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("passes a tier's own error through", async () => {
    await expect(runCappedRefreshCycle([['a', () => Promise.reject(new Error('vault: 503'))], ['b', done]])).rejects.toThrow('vault: 503')
  })
})
