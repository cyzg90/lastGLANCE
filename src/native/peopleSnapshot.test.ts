import { describe, it, expect, vi } from 'vitest'
import dayjs from 'dayjs'
import type { TFunction } from 'i18next'

// pendingDeepLink.ts reaches the widget bridge, which registers a Capacitor
// plugin at import time.
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false },
  registerPlugin: () => ({}),
}))

import { buildPeopleSnapshot, WIDGET_COMING_UP, WIDGET_REACH_OUT } from './peopleSnapshot'
import { peopleRequest } from './pendingDeepLink'
import { NO_SIGNALS } from '@/people/reciprocity'
import type { PersonDate, PersonWithLastInteraction } from '@/people/types'

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

describe('buildPeopleSnapshot', () => {
  it('lists Reach out most overdue first, with a bar colour and the card detail', () => {
    const late = person({ name: 'Late', target_cadence_days: 7, elapsed_days: 14, last_interaction_at: '2026-09-28T12:00:00' })
    const due = person({ name: 'Due', target_cadence_days: 7, elapsed_days: 7, last_interaction_at: '2026-10-05T12:00:00' })
    const fresh = person({ name: 'Fresh', target_cadence_days: 7, elapsed_days: 1 })
    const snap = buildPeopleSnapshot(t, [due, fresh, late], [], NOW, true)
    expect(snap.reachOut.map(r => r.name)).toEqual(['Late', 'Due'])
    expect(snap.reachOut[0]).toMatchObject({ syncId: late.sync_id, ratio: 2 })
    expect(snap.reachOut[0].color).toMatch(/^#[0-9a-f]{6}$/)
    expect(snap.reachOut[0].detail).toMatch(/^people\.detail\.lastContact /)
  })

  it('gives someone there for a date alone the date colour and the date line', () => {
    const p = person({ name: 'Bday' })
    const [r] = buildPeopleSnapshot(t, [p], [date(p.sync_id, 10, 14)], NOW, true).reachOut
    expect(r.ratio).toBeNull()
    expect(r.color).toBe('#f472b6')
    expect(r.detail).toBe('people.dateKind.birthday · nextDue.inDays {"count":2}')
  })

  it(`caps Reach out at ${WIDGET_REACH_OUT} and Coming up at ${WIDGET_COMING_UP}`, () => {
    const people = Array.from({ length: 12 }, () => person({ target_cadence_days: 7, elapsed_days: 10 }))
    const dates = people.map((p, i) => date(p.sync_id, 11, i + 1))
    const snap = buildPeopleSnapshot(t, people, dates, NOW, true)
    expect(snap.reachOut).toHaveLength(WIDGET_REACH_OUT)
    expect(snap.comingUp).toHaveLength(WIDGET_COMING_UP)
  })

  it('sends Coming up as local days with the age, leaving the counting to the widget', () => {
    const p = person({ name: 'Sam' })
    const snap = buildPeopleSnapshot(t, [p], [
      date(p.sync_id, 10, 20, { year: 1986 }),
      date(p.sync_id, 11, 2, { kind: 'custom', label: 'Name day' }),
    ], NOW, true)
    expect(snap.comingUp).toEqual([
      { personSyncId: p.sync_id, name: 'Sam', label: 'people.dateKind.birthday (40)', on: '2026-10-20' },
      { personSyncId: p.sync_id, name: 'Sam', label: 'Name day', on: '2026-11-02' },
    ])
  })

  it('leaves archived people out of both lists', () => {
    const gone = person({ archived: true, target_cadence_days: 7, elapsed_days: 30 })
    const snap = buildPeopleSnapshot(t, [gone], [date(gone.sync_id, 10, 13)], NOW, true)
    expect(snap.reachOut).toEqual([])
    expect(snap.comingUp).toEqual([])
  })

  it('hands the widget an in-days pattern with the placeholder intact', () => {
    const real = ((key: string, opts?: { count?: number }) =>
      key === 'nextDue.inDays' ? `in ${opts?.count}d` : key) as unknown as TFunction
    expect(buildPeopleSnapshot(real, [], [], NOW, true).labels.inDays).toBe('in {{count}}d')
  })
})

describe('peopleRequest', () => {
  it('maps widget tokens to People requests', () => {
    expect(peopleRequest('person:abc')).toEqual({ action: 'open', personSyncId: 'abc' })
    expect(peopleRequest('log:abc')).toEqual({ action: 'log', personSyncId: 'abc' })
    expect(peopleRequest('people')).toEqual({ action: 'home' })
  })

  it('ignores anything else', () => {
    expect(peopleRequest('person:')).toBeNull()
    expect(peopleRequest('chore:abc')).toBeNull()
    expect(peopleRequest('nonsense')).toBeNull()
  })
})
