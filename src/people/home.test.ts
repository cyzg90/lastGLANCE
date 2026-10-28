import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import {
  daysToWeeks, dueDate, groupByCircle, nextOccurrence, reachOutList, suggestedChannel, upcomingDates, visibleToMe,
  weeksToDays,
} from './home'
import { NO_SIGNALS } from './reciprocity'
import type { PersonCircle, PersonDate, PersonWithLastInteraction } from './types'

const NOW = dayjs('2026-10-12T15:00:00')

let seq = 0
function person(over: Partial<PersonWithLastInteraction> = {}): PersonWithLastInteraction {
  seq += 1
  return {
    sync_id: `p${seq}`, name: `Person ${seq}`, nickname: null, circle_sync_id: null,
    target_cadence_days: 14, preferred_channel: null, details: null, archived: false,
    snoozed_until: null, owner_user_sync_id: null, created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z', last_interaction_at: null, last_channel: null, last_direction: null,
    elapsed_days: 0, reciprocity: NO_SIGNALS, ...over,
  }
}

function date(personId: string, month: number, day: number, year: number | null = null): PersonDate {
  return {
    sync_id: `d-${personId}-${month}-${day}`, person_sync_id: personId, kind: 'birthday', label: null,
    month, day, year, remind_days_before: 0, updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function circle(id: string, name: string, sort: number): PersonCircle {
  return { sync_id: id, name, icon: null, sort_order: sort, updated_at: '2026-01-01T00:00:00.000Z' }
}

describe('visibleToMe', () => {
  it('shows everyone with multi-user off, and only mine plus unowned with it on', () => {
    const mine = person({ owner_user_sync_id: 'me' })
    const theirs = person({ owner_user_sync_id: 'them' })
    const unowned = person()
    expect(visibleToMe([mine, theirs, unowned], false, 'me')).toHaveLength(3)
    expect(visibleToMe([mine, theirs, unowned], true, 'me')).toEqual([mine, unowned])
  })
})

describe('reachOutList', () => {
  const names = (items: { person: PersonWithLastInteraction }[]) => items.map(i => i.person.name)

  it('lists people in the attention zone, most overdue first, capped', () => {
    const fresh = person({ name: 'fresh', elapsed_days: 3 })            // 0.21
    const amber = person({ name: 'amber', elapsed_days: 11 })           // 0.79
    const late = person({ name: 'late', elapsed_days: 28 })             // 2.0
    const none = person({ name: 'none', target_cadence_days: null, elapsed_days: 400 })
    expect(names(reachOutList([fresh, amber, late, none], [], NOW))).toEqual(['late', 'amber'])
    expect(names(reachOutList([amber, late], [], NOW, { limit: 1 }))).toEqual(['late'])
  })

  it('leaves out snoozed and archived people until the snooze ends', () => {
    const snoozed = person({ name: 'snoozed', elapsed_days: 30, snoozed_until: NOW.add(2, 'day').toISOString() })
    const woke = person({ name: 'woke', elapsed_days: 30, snoozed_until: NOW.subtract(1, 'day').toISOString() })
    const archived = person({ name: 'archived', elapsed_days: 30, archived: true })
    expect(names(reachOutList([snoozed, woke, archived], [], NOW))).toEqual(['woke'])
  })

  it('brings in anyone with a date in the next week, first and soonest first, with the date as the reason', () => {
    const late = person({ name: 'late', elapsed_days: 40 })
    const noCadence = person({ name: 'noCadence', target_cadence_days: null })
    const fresh = person({ name: 'fresh', elapsed_days: 1 })
    const far = person({ name: 'far', target_cadence_days: null })
    const out = reachOutList(
      [late, noCadence, fresh, far],
      [date(noCadence.sync_id, 10, 18), date(fresh.sync_id, 10, 13), date(far.sync_id, 10, 25)],
      NOW,
    )
    expect(names(out)).toEqual(['fresh', 'noCadence', 'late'])
    expect(out[0].reason).toMatchObject({ kind: 'date', upcoming: { daysUntil: 1 } })
  })

  it('lets an unreturned inbound in at half its cadence and labels it ahead of a streak', () => {
    const owed = person({ name: 'owed', elapsed_days: 8, reciprocity: { ...NO_SIGNALS, unreturned: true, lastInitiator: 'inbound', inbound: 1 } })
    const drifting = person({ name: 'drifting', elapsed_days: 8 })
    const streak = person({ name: 'streak', elapsed_days: 20, reciprocity: { ...NO_SIGNALS, streak: 3, outbound: 3, lastInitiator: 'outbound' } })
    const out = reachOutList([owed, drifting, streak], [], NOW)
    expect(names(out)).toEqual(['streak', 'owed'])
    expect(out.map(i => i.reason)).toEqual([{ kind: 'streak', count: 3 }, { kind: 'unreturned' }])
    // Hidden reciprocity still shapes the list but shows no reason.
    expect(reachOutList([owed, streak], [], NOW, { showReciprocity: false }).map(i => i.reason)).toEqual([null, null])
  })

  it('breaks a tie on ratio by days past cadence, then an unreturned inbound, then time since contact', () => {
    const long = person({ name: 'long', target_cadence_days: 28, elapsed_days: 56 })
    const short = person({ name: 'short', target_cadence_days: 7, elapsed_days: 14 })
    expect(names(reachOutList([short, long], [], NOW))).toEqual(['long', 'short'])
    const owed = person({ name: 'owed', elapsed_days: 21, reciprocity: { ...NO_SIGNALS, unreturned: true } })
    const plain = person({ name: 'plain', elapsed_days: 21 })
    expect(names(reachOutList([plain, owed], [], NOW))).toEqual(['owed', 'plain'])
  })
})

describe('suggestedChannel and dueDate', () => {
  it('prefers the preferred channel, else the last one, and dates the catch-up from last contact', () => {
    expect(suggestedChannel(person({ preferred_channel: 'text', last_channel: 'call' }))).toBe('text')
    expect(suggestedChannel(person({ last_channel: 'call' }))).toBe('call')
    const p = person({ last_interaction_at: '2026-10-01T12:00:00.000Z', target_cadence_days: 14 })
    expect(dueDate(p)?.toISOString()).toBe('2026-10-15T12:00:00.000Z')
    expect(dueDate(person({ target_cadence_days: null }))).toBeNull()
  })
})

describe('nextOccurrence', () => {
  it('is today when the date is today, else this year or next', () => {
    expect(nextOccurrence(10, 12, NOW).format('YYYY-MM-DD')).toBe('2026-10-12')
    expect(nextOccurrence(12, 25, NOW).format('YYYY-MM-DD')).toBe('2026-12-25')
    expect(nextOccurrence(3, 1, NOW).format('YYYY-MM-DD')).toBe('2027-03-01')
  })

  it('puts Feb 29 on Feb 28 in a common year and keeps it in a leap year', () => {
    expect(nextOccurrence(2, 29, NOW).format('YYYY-MM-DD')).toBe('2027-02-28')
    expect(nextOccurrence(2, 29, dayjs('2027-06-01')).format('YYYY-MM-DD')).toBe('2028-02-29')
  })
})

describe('upcomingDates', () => {
  it('keeps dates within the window, soonest first, with the age when the year is known', () => {
    const a = person({ name: 'Ana' })
    const b = person({ name: 'Ben' })
    const gone = person({ archived: true })
    const out = upcomingDates(
      [date(a.sync_id, 11, 1, 1990), date(b.sync_id, 10, 12), date(b.sync_id, 12, 31), date(gone.sync_id, 10, 13)],
      [a, b, gone],
      NOW,
    )
    expect(out.map(u => [u.person.name, u.daysUntil, u.turning])).toEqual([
      ['Ben', 0, null],
      ['Ana', 20, 36],
    ])
  })
})

describe('groupByCircle', () => {
  it('follows circle order, keeps empty circles, and puts the ungrouped last', () => {
    const family = circle('c1', 'Family', 1)
    const work = circle('c2', 'Work', 0)
    const zoe = person({ name: 'Zoe', circle_sync_id: 'c1' })
    const al = person({ name: 'Al', circle_sync_id: 'c1' })
    const loose = person({ name: 'Loose' })
    const orphan = person({ name: 'Orphan', circle_sync_id: 'deleted' })
    const groups = groupByCircle([zoe, al, loose, orphan], [work, family])
    expect(groups.map(g => [g.circle?.name ?? null, g.people.map(p => p.name)])).toEqual([
      ['Work', []],
      ['Family', ['Al', 'Zoe']],
      [null, ['Loose', 'Orphan']],
    ])
  })
})

describe('cadence in weeks', () => {
  it('converts weeks to days and back', () => {
    expect(weeksToDays('2')).toBe(14)
    expect(weeksToDays('1.5')).toBe(11)
    expect(weeksToDays('')).toBeNull()
    expect(weeksToDays('0')).toBeNull()
    expect(weeksToDays('abc')).toBeNull()
    expect(daysToWeeks(14)).toBe('2')
    expect(daysToWeeks(10)).toBe('1.4')
    expect(daysToWeeks(null)).toBe('')
  })
})
