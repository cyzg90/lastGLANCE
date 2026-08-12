import { describe, it, expect } from 'vitest'
import { describeBackoff, backoffStatusText } from './backoffStatus'
import type { TFunction } from 'i18next'

const NOW = 1_000_000_000
const win = (over: Partial<{ until: number; reason: string; code: string }>) => ({
  until: 0, strikes: 0, reason: null, code: null, since: null, ...over,
}) as never

const t = ((key: string, opts?: { seconds?: number }) =>
  opts?.seconds != null ? `${key}:${opts.seconds}` : key) as unknown as TFunction

describe('describeBackoff', () => {
  it('returns null when both windows are clear', () => {
    expect(describeBackoff({ push: win({}), pull: win({}) }, NOW)).toBeNull()
  })

  it('describes an open transport window with a whole-second countdown', () => {
    const d = describeBackoff(
      { push: win({ until: NOW + 12_400, reason: 'transport', code: 'NETWORK_ERROR' }), pull: win({}) },
      NOW,
    )
    expect(d).toEqual({ reason: 'transport', side: 'push', until: NOW + 12_400, secondsLeft: 13 })
  })

  it('describes an auth window', () => {
    const d = describeBackoff(
      { push: win({}), pull: win({ until: NOW + 3_600_000, reason: 'auth', code: 'AUTH_FAILURE' }) },
      NOW,
    )
    expect(d?.reason).toBe('auth')
    expect(d?.side).toBe('pull')
  })

  it('excludes quota windows (they have their own standing display)', () => {
    expect(describeBackoff(
      { push: win({ until: NOW + 60_000, reason: 'quota', code: 'QUOTA_EXCEEDED' }), pull: win({}) },
      NOW,
    )).toBeNull()
  })

  it('with both open, the later until wins (auth hour outranks transport ladder)', () => {
    const d = describeBackoff(
      {
        push: win({ until: NOW + 30_000, reason: 'transport', code: 'NETWORK_ERROR' }),
        pull: win({ until: NOW + 3_600_000, reason: 'auth', code: 'AUTH_FAILURE' }),
      },
      NOW,
    )
    expect(d?.reason).toBe('auth')
  })

  it('a lapsed-but-uncleared window reports secondsLeft 0, not null', () => {
    const d = describeBackoff(
      { push: win({ until: NOW - 5_000, reason: 'transport', code: 'NETWORK_ERROR' }), pull: win({}) },
      NOW,
    )
    expect(d?.secondsLeft).toBe(0)
  })

  it('handles a missing state defensively', () => {
    expect(describeBackoff(null, NOW)).toBeNull()
    expect(describeBackoff(undefined, NOW)).toBeNull()
  })
})

describe('backoffStatusText', () => {
  it('transport counts down; auth is flat; lapsed says retrying', () => {
    expect(backoffStatusText(t, { reason: 'transport', side: 'push', until: 0, secondsLeft: 25 }))
      .toBe('sync.backoff.transport:25')
    expect(backoffStatusText(t, { reason: 'auth', side: 'pull', until: 0, secondsLeft: 3600 }))
      .toBe('sync.backoff.auth')
    expect(backoffStatusText(t, { reason: 'transport', side: 'push', until: 0, secondsLeft: 0 }))
      .toBe('sync.backoff.retrying')
    expect(backoffStatusText(t, null)).toBeNull()
  })
})
