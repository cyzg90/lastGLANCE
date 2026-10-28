import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import type { TFunction } from 'i18next'
import { buildPeopleReminders, DATE_HORIZON_DAYS, DIGEST_DAYS, digestPeople } from './reminders'
import { NO_SIGNALS } from './reciprocity'
import type { PersonDate, PersonWithLastInteraction } from './types'

// Echoes the key and its options, so tests read which string was chosen.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key} ${JSON.stringify(opts)}` : key) as unknown as TFunction

const NOW = dayjs('2026-10-12T15:00:00')

let seq = 0
function person(over: Partial<PersonWithLastInteraction> = {}): PersonWithLastInteraction {
  seq += 1
  return {
    sync_id: `p${seq}`, name: `Person ${seq}`, nickname: null, circle_sync_id: null,
    target_cadence_days: null, preferred_channel: null, details: null, archived: false,
    snoozed_until: null, owner_user_sync_id: null, created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z', last_interaction_at: null, last_channel: null, last_direction: null,
    elapsed_days: 0, reciprocity: NO_SIGNALS, ...over,
  }
}

function date(personId: string, month: number, day: number, over: Partial<PersonDate> = {}): PersonDate {
  return {
    sync_id: `d-${personId}-${month}-${day}`, person_sync_id: personId, kind: 'birthday', label: null,
    month, day, year: null, remind_days_before: 0, updated_at: '2026-01-01T00:00:00.000Z', ...over,
  }
}

const dateOnly = (people: PersonWithLastInteraction[], dates: PersonDate[], now = NOW) =>
  buildPeopleReminders(t, people, dates, { now }).filter(r => r.kind === 'person-date')

describe('date reminders', () => {
  it('fires at 9:00 on the day, naming the age when the year is known', () => {
    const sam = person({ name: 'Sam' })
    const [r] = dateOnly([sam], [date(sam.sync_id, 10, 20, { year: 1986 })])
    expect(r.at.format('YYYY-MM-DD HH:mm')).toBe('2026-10-20 09:00')
    expect(r.title).toBe('Sam')
    expect(r.body).toBe('people.reminders.turnsToday {"age":40}')
  })

  it('uses the plain line for other kinds and for a birthday with no year', () => {
    const p = person()
    const rs = dateOnly([p], [
      date(p.sync_id, 10, 20),
      date(p.sync_id, 11, 1, { kind: 'custom', label: 'Name day' }),
    ])
    expect(rs.map(r => r.body)).toEqual([
      'people.reminders.today {"label":"people.dateKind.birthday"}',
      'people.reminders.today {"label":"Name day"}',
    ])
  })

  it("rolls today's to next year once 9:00 has passed, which leaves it past the horizon", () => {
    const p = person()
    expect(dateOnly([p], [date(p.sync_id, 10, 12)])).toEqual([])
    const morning = dateOnly([p], [date(p.sync_id, 10, 12)], dayjs('2026-10-12T08:00:00'))
    expect(morning[0].at.format('YYYY-MM-DD HH:mm')).toBe('2026-10-12 09:00')
  })

  it(`schedules only dates within ${DATE_HORIZON_DAYS} days`, () => {
    const p = person()
    const rs = dateOnly([p], [date(p.sync_id, 12, 1), date(p.sync_id, 12, 31)])
    expect(rs.map(r => r.at.format('MM-DD'))).toEqual(['12-01'])
  })

  it('adds a heads-up the chosen days before, with its own stable key', () => {
    const p = person()
    const rs = dateOnly([p], [date(p.sync_id, 10, 20, { remind_days_before: 3, year: 1990 })])
    expect(rs.map(r => [r.key, r.at.format('YYYY-MM-DD HH:mm')])).toEqual([
      [`d-${p.sync_id}-10-20:day`, '2026-10-20 09:00'],
      [`d-${p.sync_id}-10-20:early`, '2026-10-17 09:00'],
    ])
    expect(rs[1].body).toBe('people.reminders.inDays {"count":3,"label":"people.dateKind.birthday (36)"}')
  })

  it('moves a heads-up whose moment has passed to the next year', () => {
    const p = person()
    // Oct 13, 7 days ahead: the heads-up would have been Oct 6.
    const rs = dateOnly([p], [date(p.sync_id, 10, 13, { remind_days_before: 7 })])
    expect(rs.map(r => r.key)).toEqual([`d-${p.sync_id}-10-13:day`])
  })

  it('skips archived people, people not in the list, and everything when date reminders are off', () => {
    const gone = person({ archived: true })
    const dates = [date(gone.sync_id, 10, 20), date('someone-else', 10, 21)]
    expect(dateOnly([gone], dates)).toEqual([])
    const p = person()
    expect(buildPeopleReminders(t, [p], [date(p.sync_id, 10, 20)], { now: NOW, datesOn: false })).toEqual([])
  })
})

describe('the digest', () => {
  const overdue = (over: Partial<PersonWithLastInteraction> = {}) => person({
    notify_when_overdue: true, target_cadence_days: 14, last_interaction_at: '2026-09-01T12:00:00', ...over,
  })

  it('names only people who opted in, have a cadence, are due and are not snoozed', () => {
    const at = NOW.hour(18)
    const yes = overdue({ name: 'Yes' })
    const people = [
      yes,
      overdue({ notify_when_overdue: false }),
      overdue({ notify_when_overdue: undefined }),
      overdue({ target_cadence_days: null }),
      overdue({ last_interaction_at: '2026-10-10T12:00:00' }),
      overdue({ snoozed_until: '2026-10-20T00:00:00' }),
    ]
    expect(digestPeople(people, at).map(p => p.name)).toEqual(['Yes'])
  })

  it('fires once a day at 18:00 for a week, counting who will be due by then', () => {
    const a = overdue({ name: 'A' })
    // Due Oct 15 at noon, so in from the Oct 15 digest on.
    const b = overdue({ name: 'B', last_interaction_at: '2026-10-01T12:00:00' })
    const rs = buildPeopleReminders(t, [a, b], [], { now: NOW }).filter(r => r.kind === 'people-digest')
    expect(rs).toHaveLength(DIGEST_DAYS)
    expect(rs[0].at.format('YYYY-MM-DD HH:mm')).toBe('2026-10-12 18:00')
    expect(rs[0].title).toBe('people.reminders.digestOne {"name":"A"}')
    expect(rs[3].title).toBe('people.reminders.digest {"count":2}')
    expect(rs[3].body).toBe('A and B')
    expect(new Set(rs.map(r => r.key)).size).toBe(DIGEST_DAYS)
  })

  it('starts tomorrow once the evening slot has passed, and skips days with nobody due', () => {
    const late = dayjs('2026-10-12T19:00:00')
    const later = overdue({ last_interaction_at: '2026-10-01T12:00:00' })
    const rs = buildPeopleReminders(t, [later], [], { now: late })
    expect(rs[0].at.format('YYYY-MM-DD HH:mm')).toBe('2026-10-15 18:00')
    // Slots Oct 13 to 19; nobody is due on the 13th or 14th.
    expect(rs).toHaveLength(DIGEST_DAYS - 2)
  })

  it('says how long it has been for one person, and folds the rest into "N more" past three', () => {
    const one = buildPeopleReminders(t, [overdue()], [], { now: NOW })[0]
    expect(one.body).toBe('notifications.itsBeenDays {"count":41}')

    const many = Array.from({ length: 5 }, (_, i) => overdue({
      name: `P${i}`, last_interaction_at: `2026-09-0${i + 1}T12:00:00`,
    }))
    const r = buildPeopleReminders(t, many, [], { now: NOW })[0]
    expect(r.body).toBe('P0, P1, P2, and people.reminders.more {"count":2}')
  })

  it('leaves archived people out of the digest', () => {
    expect(buildPeopleReminders(t, [overdue({ archived: true })], [], { now: NOW })).toEqual([])
  })
})

describe('reminder times', () => {
  it('uses the chosen date time for the day and the heads-up', () => {
    const p = person()
    const rs = buildPeopleReminders(t, [p], [date(p.sync_id, 10, 20, { remind_days_before: 1 })], {
      now: NOW, dateMinutes: 7 * 60 + 30,
    })
    expect(rs.map(r => r.at.format('MM-DD HH:mm'))).toEqual(['10-20 07:30', '10-19 07:30'])
  })

  it('counts a date time later today as still ahead', () => {
    const p = person()
    const [r] = buildPeopleReminders(t, [p], [date(p.sync_id, 10, 12)], { now: NOW, dateMinutes: 20 * 60 })
    expect(r.at.format('YYYY-MM-DD HH:mm')).toBe('2026-10-12 20:00')
  })

  it('uses the chosen digest time, starting tomorrow once it has passed today', () => {
    const p = person({ notify_when_overdue: true, target_cadence_days: 14, last_interaction_at: '2026-09-01T12:00:00' })
    const early = buildPeopleReminders(t, [p], [], { now: NOW, digestMinutes: 8 * 60 + 15 })
    expect(early[0].at.format('YYYY-MM-DD HH:mm')).toBe('2026-10-13 08:15')
    expect(early[6].at.format('YYYY-MM-DD HH:mm')).toBe('2026-10-19 08:15')
    const late = buildPeopleReminders(t, [p], [], { now: NOW, digestMinutes: 21 * 60 })
    expect(late[0].at.format('YYYY-MM-DD HH:mm')).toBe('2026-10-12 21:00')
  })
})
