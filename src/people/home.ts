// Pure helpers behind the People home screen: who to reach out to, which
// dates are coming up, and the circle grouping. Kept free of React and Dexie
// so the rules are testable on their own.

import dayjs, { type Dayjs } from 'dayjs'
import { ATTENTION_RATIO, getFillRatio } from '@/utils/cadence'
import { STREAK_MIN } from './reciprocity'
import type { InteractionChannel, PersonCircle, PersonDate, PersonWithLastInteraction } from './types'

export const REACH_OUT_LIMIT = 5
export const COMING_UP_DAYS = 30

// Household privacy: with multi-user on, each member sees only their own
// People. A person with no owner was added while multi-user was off and reads
// as everyone's, matching how the data layer stamps owners.
export function visibleToMe(
  people: PersonWithLastInteraction[],
  multiUserEnabled: boolean,
  meId: string | null,
): PersonWithLastInteraction[] {
  if (!multiUserEnabled || !meId) return people
  return people.filter(p => p.owner_user_sync_id === null || p.owner_user_sync_id === meId)
}

export function isSnoozed(person: Pick<PersonWithLastInteraction, 'snoozed_until'>, now: Dayjs = dayjs()): boolean {
  return !!person.snoozed_until && dayjs(person.snoozed_until).isAfter(now)
}

export function cadenceRatio(person: PersonWithLastInteraction): number | null {
  if (!person.target_cadence_days) return null
  return getFillRatio(person.elapsed_days, person.target_cadence_days)
}

// A date this close puts someone on Reach out whatever their cadence says.
export const DATE_BOOST_DAYS = 7
// Owing someone a reply is actionable sooner than drift, so an unreturned
// inbound enters the list at half its cadence instead of ATTENTION_RATIO.
export const UNRETURNED_RATIO = 0.5

// One line on the card saying why someone is there. At most one per card:
// a date first, then an unreturned inbound, then a run of reach-outs.
export type ReachOutReason =
  | { kind: 'date'; upcoming: UpcomingDate }
  | { kind: 'unreturned' }
  | { kind: 'streak'; count: number }

export interface ReachOutItem {
  person: PersonWithLastInteraction
  reason: ReachOutReason | null
}

// The Reach out list (docs: the People spec, Suggestions). Archived and
// snoozed people are left out. A date in the next week brings someone in
// regardless of cadence and goes first, soonest date first. Everyone else
// needs a cadence and enters once its ratio passes ATTENTION_RATIO (or
// UNRETURNED_RATIO when they got in touch last), most overdue first; ties go
// to whoever is furthest past their cadence in days, then to an unreturned
// inbound, then to who was contacted longest ago. Recency for someone never
// logged counts from when they were added, so a bulk import does not flood the
// list. Reciprocity shapes entry and order even with its display turned off;
// `showReciprocity` only decides whether its reasons are shown.
export function reachOutList(
  people: PersonWithLastInteraction[],
  dates: PersonDate[],
  now: Dayjs = dayjs(),
  { limit = REACH_OUT_LIMIT, showReciprocity = true }: { limit?: number; showReciprocity?: boolean } = {},
): ReachOutItem[] {
  const candidates = people.filter(p => !p.archived && !isSnoozed(p, now))
  const boosts = new Map<string, UpcomingDate>()
  for (const u of upcomingDates(dates, candidates, now, DATE_BOOST_DAYS)) {
    if (!boosts.has(u.person.sync_id)) boosts.set(u.person.sync_id, u)
  }

  const boosted: ReachOutItem[] = []
  const scored: { item: ReachOutItem; ratio: number; overdueDays: number }[] = []
  for (const p of candidates) {
    const upcoming = boosts.get(p.sync_id)
    const r = p.reciprocity
    const reciprocityReason: ReachOutReason | null = !showReciprocity ? null
      : r.unreturned ? { kind: 'unreturned' }
      : r.streak >= STREAK_MIN ? { kind: 'streak', count: r.streak }
      : null
    if (upcoming) {
      boosted.push({ person: p, reason: { kind: 'date', upcoming } })
      continue
    }
    const ratio = cadenceRatio(p)
    if (ratio === null || ratio < (r.unreturned ? UNRETURNED_RATIO : ATTENTION_RATIO)) continue
    scored.push({
      item: { person: p, reason: reciprocityReason },
      ratio,
      overdueDays: p.elapsed_days - (p.target_cadence_days ?? 0),
    })
  }

  boosted.sort((a, b) => {
    const ua = (a.reason as { upcoming: UpcomingDate }).upcoming
    const ub = (b.reason as { upcoming: UpcomingDate }).upcoming
    return ua.daysUntil - ub.daysUntil || a.person.name.localeCompare(b.person.name)
  })
  scored.sort((a, b) =>
    b.ratio - a.ratio
    || b.overdueDays - a.overdueDays
    || Number(b.item.person.reciprocity.unreturned) - Number(a.item.person.reciprocity.unreturned)
    || b.item.person.elapsed_days - a.item.person.elapsed_days
    || a.item.person.name.localeCompare(b.item.person.name))

  return [...boosted, ...scored.map(s => s.item)].slice(0, limit)
}

// The channel a card suggests: the person's preferred one, else whatever was
// used last.
export function suggestedChannel(p: PersonWithLastInteraction): InteractionChannel | null {
  return p.preferred_channel ?? p.last_channel
}

// When the next catch-up is due: last contact (or when they were added) plus
// the cadence. Null without a cadence.
export function dueDate(p: PersonWithLastInteraction): Dayjs | null {
  if (!p.target_cadence_days) return null
  return dayjs(p.last_interaction_at ?? p.created_at).add(p.target_cadence_days, 'day')
}

export const SNOOZE_DAYS = [3, 7, 14] as const

export function snoozeUntil(days: number, now: Dayjs = dayjs()): string {
  return now.add(days, 'day').toISOString()
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

// The next time a month/day falls on or after `from` (start of day). A Feb 29
// date lands on Feb 28 in years without one.
export function nextOccurrence(month: number, day: number, from: Dayjs = dayjs()): Dayjs {
  const start = from.startOf('day')
  const at = (year: number) => {
    const d = month === 2 && day === 29 && !isLeap(year) ? 28 : day
    return dayjs(new Date(year, month - 1, d))
  }
  const thisYear = at(start.year())
  return thisYear.isBefore(start) ? at(start.year() + 1) : thisYear
}

export interface UpcomingDate {
  date: PersonDate
  person: PersonWithLastInteraction
  on: Dayjs
  daysUntil: number
  // The age or years married on that day, when the year is known.
  turning: number | null
}

export function upcomingDates(
  dates: PersonDate[],
  people: PersonWithLastInteraction[],
  now: Dayjs = dayjs(),
  windowDays = COMING_UP_DAYS,
): UpcomingDate[] {
  const byId = new Map(people.filter(p => !p.archived).map(p => [p.sync_id, p]))
  const today = now.startOf('day')
  const out: UpcomingDate[] = []
  for (const date of dates) {
    const person = byId.get(date.person_sync_id)
    if (!person) continue
    const on = nextOccurrence(date.month, date.day, today)
    const daysUntil = on.diff(today, 'day')
    if (daysUntil > windowDays) continue
    const turning = date.year !== null && on.year() > date.year ? on.year() - date.year : null
    out.push({ date, person, on, daysUntil, turning })
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.person.name.localeCompare(b.person.name))
}

export interface CircleGroup {
  circle: PersonCircle | null
  people: PersonWithLastInteraction[]
}

// Everyone, grouped by circle in the circles' own order, with the ungrouped
// last. Empty circles are kept so a new circle shows up straight away.
export function groupByCircle(people: PersonWithLastInteraction[], circles: PersonCircle[]): CircleGroup[] {
  const known = new Set(circles.map(c => c.sync_id))
  const byName = (a: PersonWithLastInteraction, b: PersonWithLastInteraction) => a.name.localeCompare(b.name)
  const groups: CircleGroup[] = circles.map(circle => ({
    circle,
    people: people.filter(p => p.circle_sync_id === circle.sync_id).sort(byName),
  }))
  const loose = people.filter(p => !p.circle_sync_id || !known.has(p.circle_sync_id)).sort(byName)
  if (loose.length) groups.push({ circle: null, people: loose })
  return groups
}

// Cadence is entered in weeks and stored in days.
export function weeksToDays(weeks: string): number | null {
  const n = Number(weeks.trim())
  if (!weeks.trim() || !Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 7)
}

export function daysToWeeks(days: number | null): string {
  if (!days) return ''
  const w = days / 7
  return Number.isInteger(w) ? String(w) : String(Math.round(w * 10) / 10)
}
