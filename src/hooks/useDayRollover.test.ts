import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { msUntilNextLocalMidnight, localDayKey } from './useDayRollover'

// Local time, so these are stable regardless of the runner's zone: the boundary
// under test is the *local* midnight, not UTC's.
function at(local: string): number {
  return new Date(local).getTime()
}

afterEach(() => { vi.useRealTimers() })

describe('msUntilNextLocalMidnight', () => {
  it('counts to the next local midnight, not 24h out', () => {
    const now = at('2026-03-10T09:30:00')
    expect(msUntilNextLocalMidnight(now)).toBe(at('2026-03-11T00:00:00') - now)
  })

  it('returns a full day one tick after midnight', () => {
    const now = at('2026-03-10T00:00:00')
    expect(msUntilNextLocalMidnight(now)).toBe(at('2026-03-11T00:00:00') - now)
  })

  it('never returns zero or negative, so a re-arming caller cannot spin', () => {
    // One millisecond before the boundary is the tightest case there is.
    const now = at('2026-03-10T23:59:59.999')
    const ms = msUntilNextLocalMidnight(now)
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThanOrEqual(1)
  })

  it('lands exactly on midnight from any point in the day', () => {
    for (const hour of [0, 1, 6, 12, 18, 23]) {
      const now = at(`2026-06-15T${String(hour).padStart(2, '0')}:17:03.250`)
      const landing = new Date(now + msUntilNextLocalMidnight(now))
      expect(landing.getHours()).toBe(0)
      expect(landing.getMinutes()).toBe(0)
      expect(landing.getSeconds()).toBe(0)
      expect(landing.getMilliseconds()).toBe(0)
    }
  })

  it('defaults to the current clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-03-10T09:30:00'))
    expect(msUntilNextLocalMidnight()).toBe(msUntilNextLocalMidnight(Date.now()))
  })
})

// Pinned to a DST-observing zone, because the whole point of deriving the delay
// from the clock is that a local day is not always 24h. In a fixed-offset zone
// (UTC on CI) a naive +24h constant would pass every assertion here.
describe('msUntilNextLocalMidnight across DST', () => {
  const original = process.env.TZ
  beforeAll(() => { process.env.TZ = 'America/Denver' })
  afterAll(() => { process.env.TZ = original })

  const HOUR = 60 * 60 * 1000

  it('spans only 23h on a spring-forward day', () => {
    // US spring forward 2026 is Mar 8 at 02:00. A timer chained at a fixed
    // +24h from the previous midnight would fire at 01:00 on Mar 9 and every
    // day after, an hour late forever.
    const midnight = at('2026-03-08T00:00:00')
    expect(msUntilNextLocalMidnight(midnight)).toBe(23 * HOUR)
  })

  it('spans 25h on a fall-back day', () => {
    // US fall back 2026 is Nov 1 at 02:00; the same chained timer fires an
    // hour early, before the date has actually changed.
    const midnight = at('2026-11-01T00:00:00')
    expect(msUntilNextLocalMidnight(midnight)).toBe(25 * HOUR)
  })

  it('still lands exactly on midnight through both shifts', () => {
    for (const day of ['2026-03-07', '2026-03-08', '2026-10-31', '2026-11-01']) {
      const now = at(`${day}T13:45:00`)
      const landing = new Date(now + msUntilNextLocalMidnight(now))
      expect(landing.getHours()).toBe(0)
      expect(landing.getMinutes()).toBe(0)
    }
  })
})

describe('localDayKey', () => {
  it('is a local calendar day, and changes across local midnight', () => {
    expect(localDayKey(at('2026-03-10T23:59:59'))).toBe('2026-03-10')
    expect(localDayKey(at('2026-03-11T00:00:00'))).toBe('2026-03-11')
  })

  it('moves backwards when the clock is corrected backwards', () => {
    // Issue #306 in reverse: a machine running ~12h fast, corrected by NTP.
    // The rollover guard compares keys rather than asking "is it past
    // midnight yet", so a backwards correction is still a change.
    const wrong = localDayKey(at('2026-03-11T04:00:00'))
    const corrected = localDayKey(at('2026-03-10T16:00:00'))
    expect(corrected).not.toBe(wrong)
  })
})
