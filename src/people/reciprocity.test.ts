import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import { hasEnoughForBalance, reciprocitySignals } from './reciprocity'
import type { Interaction, InteractionDirection } from './types'

const NOW = dayjs('2026-10-12T15:00:00')

function log(daysAgo: number, direction: InteractionDirection | null | undefined): Interaction {
  return {
    sync_id: `i${daysAgo}`, person_sync_ids: ['p'], occurred_at: NOW.subtract(daysAgo, 'day').toISOString(),
    channel: 'call', direction, note: null, source: 'manual', updated_at: NOW.toISOString(),
  }
}

describe('reciprocitySignals', () => {
  it('counts a run of outbound logs back to the last inbound, skipping unrecorded ones', () => {
    const s = reciprocitySignals([log(1, 'outbound'), log(3, null), log(5, 'outbound'), log(9, 'outbound'), log(12, 'inbound'), log(20, 'outbound')], NOW)
    expect(s).toMatchObject({ lastInitiator: 'outbound', streak: 3, unreturned: false, outbound: 4, inbound: 1 })
  })

  it('ends a streak and answers an inbound at a mutual log, without counting it', () => {
    expect(reciprocitySignals([log(1, 'outbound'), log(4, 'mutual'), log(6, 'outbound'), log(8, 'outbound')], NOW))
      .toMatchObject({ streak: 1, lastInitiator: 'outbound', outbound: 3, inbound: 0 })
    expect(reciprocitySignals([log(1, 'mutual'), log(4, 'inbound')], NOW).unreturned).toBe(false)
  })

  it('marks an inbound as unreturned until something outbound or mutual follows', () => {
    expect(reciprocitySignals([log(1, null), log(2, 'inbound'), log(9, 'outbound')], NOW))
      .toMatchObject({ unreturned: true, lastInitiator: 'inbound', streak: 0 })
    expect(reciprocitySignals([log(1, 'outbound'), log(2, 'inbound')], NOW).unreturned).toBe(false)
  })

  it('ignores logs older than the window and legacy rows with no direction', () => {
    const s = reciprocitySignals([log(10, undefined), log(200, 'inbound'), log(300, 'outbound')], NOW)
    expect(s).toMatchObject({ lastInitiator: null, streak: 0, unreturned: false, outbound: 0, inbound: 0 })
  })

  it('needs six directed logs before a balance is shown', () => {
    const five = [1, 2, 3, 4].map(d => log(d, 'outbound')).concat(log(5, 'inbound'))
    expect(hasEnoughForBalance(reciprocitySignals(five, NOW))).toBe(false)
    expect(hasEnoughForBalance(reciprocitySignals([...five, log(6, 'mutual')], NOW))).toBe(false)
    expect(hasEnoughForBalance(reciprocitySignals([...five, log(6, 'inbound')], NOW))).toBe(true)
  })
})
