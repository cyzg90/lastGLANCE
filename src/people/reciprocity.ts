// Who is carrying a relationship, read from the direction on logged
// interactions (docs: the reciprocity spec). Pure and Dexie-free so the rules
// are testable on their own.

import dayjs, { type Dayjs } from 'dayjs'
import { normalizeDirection, type Interaction } from './types'

// Signals look back this far, so one enthusiastic month of logging does not
// anchor the numbers for years and a relationship that recovers can show it.
export const RECIPROCITY_WINDOW_DAYS = 180
// A run of reach-outs this long gets a reason line on the Reach out card.
export const STREAK_MIN = 3
// Below this many directed logs a balance is noise that reads as evidence.
export const BALANCE_MIN_DIRECTED = 6

export interface ReciprocitySignals {
  // Direction of the most recent outbound or inbound log.
  lastInitiator: 'outbound' | 'inbound' | null
  // Outbound logs since the last inbound or mutual one.
  streak: number
  // They got in touch and nothing outbound or mutual has been logged since.
  unreturned: boolean
  outbound: number
  inbound: number
}

export const NO_SIGNALS: ReciprocitySignals = {
  lastInitiator: null, streak: 0, unreturned: false, outbound: 0, inbound: 0,
}

// Logs with no direction are skipped everywhere. A mutual log ends a streak
// and answers an inbound one (a dinner you both planned settles a run of
// unanswered reach-outs in any sense that matters), but it never counts
// toward the balance.
export function reciprocitySignals(interactions: Interaction[], now: Dayjs = dayjs()): ReciprocitySignals {
  const since = now.subtract(RECIPROCITY_WINDOW_DAYS, 'day').toISOString()
  const recorded = interactions
    .filter(i => i.occurred_at >= since)
    .map(i => ({ at: i.occurred_at, direction: normalizeDirection(i.direction) }))
    .filter(i => i.direction !== null)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  const out = { ...NO_SIGNALS }
  let runOpen = true
  for (const { direction } of recorded) {
    if (direction === 'outbound') out.outbound++
    if (direction === 'inbound') out.inbound++
    if (!out.lastInitiator && direction !== 'mutual') out.lastInitiator = direction
    if (runOpen) {
      if (direction === 'outbound') out.streak++
      else runOpen = false
    }
  }
  out.unreturned = recorded[0]?.direction === 'inbound'
  return out
}

// "You 7, them 2" only once there is enough logged to mean something.
export function hasEnoughForBalance(s: ReciprocitySignals): boolean {
  return s.outbound + s.inbound >= BALANCE_MIN_DIRECTED
}
