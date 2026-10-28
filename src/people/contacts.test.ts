import { describe, it, expect } from 'vitest'
import { birthdayChange, contactDates, matchByName, newDates, parseContactEvent } from './contacts'
import { NO_SIGNALS } from './reciprocity'
import type { PersonDate, PersonWithLastInteraction } from './types'
import type { DeviceContactSummary } from '@/native/contacts'

const ev = (date: string, type = 3, label: string | null = null) => ({ date, type, label })

describe('parseContactEvent', () => {
  it('reads the date shapes contacts use, with and without a year', () => {
    expect(parseContactEvent(ev('1990-05-17'))).toEqual({ kind: 'birthday', label: null, month: 5, day: 17, year: 1990 })
    expect(parseContactEvent(ev('--05-17'))).toMatchObject({ month: 5, day: 17, year: null })
    expect(parseContactEvent(ev('19900517'))).toMatchObject({ month: 5, day: 17, year: 1990 })
    expect(parseContactEvent(ev('2012-06-02T00:00:00.000Z', 1))).toMatchObject({ kind: 'anniversary', month: 6, day: 2, year: 2012 })
  })

  it('treats the iCloud no-year placeholder as no year, and keeps a custom label', () => {
    expect(parseContactEvent(ev('1604-02-29'))).toMatchObject({ month: 2, day: 29, year: null })
    expect(parseContactEvent(ev('2020-09-01', 0, ' Name day '))).toMatchObject({ kind: 'custom', label: 'Name day' })
    expect(parseContactEvent(ev('2020-09-01', 2, null))).toMatchObject({ kind: 'custom', label: null })
  })

  it('skips dates it cannot read rather than guessing', () => {
    expect(parseContactEvent(ev('May 17'))).toBeNull()
    expect(parseContactEvent(ev('1990-13-01'))).toBeNull()
    expect(parseContactEvent(ev('1990-04-31'))).toBeNull()
  })
})

it('merges the same date synced from two accounts, keeping the year', () => {
  const out = contactDates([ev('--05-17'), ev('1990-05-17'), ev('nope'), ev('2010-08-08', 1)])
  expect(out.map(d => [d.kind, d.year])).toEqual([['birthday', 1990], ['anniversary', 2010]])
})

function person(name: string, over: Partial<PersonWithLastInteraction> = {}): PersonWithLastInteraction {
  return {
    sync_id: name, name, nickname: null, circle_sync_id: null, target_cadence_days: null, preferred_channel: null,
    details: null, archived: false, snoozed_until: null, owner_user_sync_id: null, created_at: '', updated_at: '',
    last_interaction_at: null, last_channel: null, last_direction: null, elapsed_days: 0, reciprocity: NO_SIGNALS, ...over,
  }
}
const contact = (key: string, name: string): DeviceContactSummary => ({ key, name, hasPhone: true, events: [] })

describe('matchByName', () => {
  it('matches ignoring case, spacing and accents, but only when one contact has the name', () => {
    const out = matchByName(
      [person('José  Ruiz'), person('Sam Lee'), person('Ana'), person('Old', { archived: true })],
      [contact('a', 'jose ruiz'), contact('b', 'Sam Lee'), contact('c', 'Sam Lee'), contact('d', 'Ana'), contact('e', 'Old')],
      [],
    )
    expect(out.map(m => [m.person.name, m.contact.key])).toEqual([['José  Ruiz', 'a'], ['Ana', 'd']])
  })

  it('leaves out people already linked and contacts already taken', () => {
    const out = matchByName(
      [person('Ana'), person('Ben')],
      [contact('a', 'Ana'), contact('b', 'Ben')],
      [{ person_sync_id: 'Ana', device_contact_key: 'x', last_synced_at: '' }, { person_sync_id: 'Zed', device_contact_key: 'b', last_synced_at: '' }],
    )
    expect(out).toEqual([])
  })
})

function date(kind: PersonDate['kind'], month: number, day: number, year: number | null = null, label: string | null = null): PersonDate {
  return { sync_id: `${kind}${month}${day}`, person_sync_id: 'p', kind, label, month, day, year, remind_days_before: 0, updated_at: '' }
}

describe('birthdayChange', () => {
  it('offers a birthday that differs, and stays quiet when it matches or the person has none', () => {
    expect(birthdayChange([date('birthday', 5, 17, 1990)], [ev('1990-05-18')])).toMatchObject({ next: { month: 5, day: 18 } })
    expect(birthdayChange([date('birthday', 5, 17, 1990)], [ev('1990-05-17')])).toBeNull()
    expect(birthdayChange([date('birthday', 5, 17)], [ev('1991-05-17')])).toMatchObject({ next: { year: 1991 } })
    expect(birthdayChange([], [ev('1990-05-17')])).toBeNull()
    expect(birthdayChange([date('birthday', 5, 17)], [])).toBeNull()
  })
})

it('newDates leaves out dates the person already has', () => {
  const have = [date('birthday', 5, 17), date('custom', 9, 1, null, 'Name day')]
  const offered = contactDates([ev('1990-05-17'), ev('2010-08-08', 1), ev('2020-09-01', 0, 'Name day'), ev('2020-09-01', 0, 'Other')])
  expect(newDates(have, offered).map(d => d.kind + (d.label ?? ''))).toEqual(['anniversary', 'customOther'])
})
