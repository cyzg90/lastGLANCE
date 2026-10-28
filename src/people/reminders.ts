// What People notifications to schedule (docs: the People spec, Reminders).
// Pure, like home.ts: src/native/reminders.ts loads the data, merges these
// with the chore reminders and does the scheduling.
//
// Dates fire at the date time (local, set in Settings) on the day, plus an
// optional heads-up `remind_days_before` days earlier at the same time.
// Overdue people never get a notification each: everyone who opted in shares
// one digest a day at the digest time, so a long list never turns into a
// stream of nags.

import dayjs, { type Dayjs } from 'dayjs'
import type { TFunction } from 'i18next'
import { dueDate, isSnoozed, nextOccurrence } from './home'
import type { PersonDate, PersonWithLastInteraction } from './types'

// Defaults for the two times, in minutes after midnight: 9 AM and 6 PM.
export const DEFAULT_DATE_MINUTES = 9 * 60
export const DEFAULT_DIGEST_MINUTES = 18 * 60
// How far ahead dates are scheduled. Every app open re-runs the schedule, so a
// short horizon loses nothing and keeps a big address book well clear of
// Android's 500-alarm limit per app.
export const DATE_HORIZON_DAYS = 60
// Digests are scheduled a week out, each counting who will be overdue by
// then, so they keep coming while the app stays closed. Logging re-runs the
// schedule and drops the person from every later one.
export const DIGEST_DAYS = 7
// Dates this close outrank chores for iOS's notification cap.
export const NEAR_DATE_DAYS = 14
// Names spelled out in a digest before the rest become "N more".
const DIGEST_NAMES = 3

export type PeopleReminder =
  | {
    kind: 'person-date'
    key: string           // stable per notification: date sync_id plus which one
    personSyncId: string
    title: string
    body: string
    at: Dayjs
  }
  | {
    kind: 'people-digest'
    key: string           // stable per day
    title: string
    body: string
    at: Dayjs
  }

function dateLabel(t: TFunction, date: PersonDate): string {
  if (date.kind === 'custom' && date.label) return date.label
  return t(`people.dateKind.${date.kind}`)
}

function turningOn(date: PersonDate, on: Dayjs): number | null {
  return date.year !== null && on.year() > date.year ? on.year() - date.year : null
}

// `minutes` after midnight on `day`, set by clock fields so a DST change
// that day does not shift it.
function atTime(day: Dayjs, minutes: number): Dayjs {
  return day.startOf('day').hour(Math.floor(minutes / 60)).minute(minutes % 60)
}

// The first occurrence whose notification, `lead` days before it at
// `minutes`, is still ahead of `now`.
function nextFiring(date: PersonDate, lead: number, minutes: number, now: Dayjs): { on: Dayjs; at: Dayjs } {
  let on = nextOccurrence(date.month, date.day, now.startOf('day').add(lead, 'day'))
  let at = atTime(on.subtract(lead, 'day'), minutes)
  if (!at.isAfter(now)) {
    on = nextOccurrence(date.month, date.day, on.add(1, 'day'))
    at = atTime(on.subtract(lead, 'day'), minutes)
  }
  return { on, at }
}

function dateReminders(
  t: TFunction,
  dates: PersonDate[],
  byId: Map<string, PersonWithLastInteraction>,
  now: Dayjs,
  minutes: number,
): PeopleReminder[] {
  const horizon = now.add(DATE_HORIZON_DAYS, 'day')
  const out: PeopleReminder[] = []
  for (const date of dates) {
    const person = byId.get(date.person_sync_id)
    if (!person) continue
    const label = dateLabel(t, date)

    const day = nextFiring(date, 0, minutes, now)
    if (day.at.isBefore(horizon)) {
      const turning = turningOn(date, day.on)
      out.push({
        kind: 'person-date',
        key: `${date.sync_id}:day`,
        personSyncId: person.sync_id,
        title: person.name,
        body: date.kind === 'birthday' && turning !== null
          ? t('people.reminders.turnsToday', { age: turning })
          : t('people.reminders.today', { label }),
        at: day.at,
      })
    }

    const lead = Math.max(0, Math.floor(date.remind_days_before || 0))
    if (lead === 0) continue
    const early = nextFiring(date, lead, minutes, now)
    if (!early.at.isBefore(horizon)) continue
    const turning = turningOn(date, early.on)
    out.push({
      kind: 'person-date',
      key: `${date.sync_id}:early`,
      personSyncId: person.sync_id,
      title: person.name,
      body: t('people.reminders.inDays', {
        count: lead,
        label: turning !== null ? `${label} (${turning})` : label,
      }),
      at: early.at,
    })
  }
  return out
}

// Who a digest firing at `at` would name: opted in, with a cadence, not
// snoozed then, and due by then. Most overdue first.
export function digestPeople(people: PersonWithLastInteraction[], at: Dayjs): PersonWithLastInteraction[] {
  return people
    .filter(p => p.notify_when_overdue && p.target_cadence_days && !isSnoozed(p, at))
    .map(p => ({ p, due: dueDate(p)! }))
    .filter(({ due }) => !due.isAfter(at))
    .sort((a, b) => a.due.valueOf() - b.due.valueOf() || a.p.name.localeCompare(b.p.name))
    .map(({ p }) => p)
}

function digestReminders(
  t: TFunction,
  people: PersonWithLastInteraction[],
  now: Dayjs,
  locale: string,
  minutes: number,
): PeopleReminder[] {
  const out: PeopleReminder[] = []
  const first = atTime(now, minutes).isAfter(now) ? now : now.add(1, 'day')
  for (let i = 0; i < DIGEST_DAYS; i++) {
    const at = atTime(first.add(i, 'day'), minutes)
    const due = digestPeople(people, at)
    if (due.length === 0) continue
    let title: string
    let body: string
    if (due.length === 1) {
      const p = due[0]
      title = t('people.reminders.digestOne', { name: p.name })
      const since = dayjs(p.last_interaction_at ?? p.created_at)
      body = t('notifications.itsBeenDays', { count: Math.max(1, at.startOf('day').diff(since.startOf('day'), 'day')) })
    } else {
      title = t('people.reminders.digest', { count: due.length })
      const names = due.slice(0, DIGEST_NAMES).map(p => p.name)
      if (due.length > DIGEST_NAMES) names.push(t('people.reminders.more', { count: due.length - DIGEST_NAMES }))
      body = listFormat(locale, names)
    }
    out.push({ kind: 'people-digest', key: `digest:${at.format('YYYY-MM-DD')}`, title, body, at })
  }
  return out
}

// Intl.ListFormat is ES2021, past this project's TS lib; every WebView the app
// runs in has it, and the catch covers any that does not.
type ListFormatCtor = new (locale: string, o: { style: string; type: string }) => { format(items: string[]): string }

export function listFormat(locale: string, items: string[]): string {
  try {
    const ListFormat = (Intl as unknown as { ListFormat: ListFormatCtor }).ListFormat
    return new ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}

// Everything People wants scheduled from `now`. `people` should already be
// the ones this user sees; archived people are dropped here.
export function buildPeopleReminders(
  t: TFunction,
  people: PersonWithLastInteraction[],
  dates: PersonDate[],
  {
    now = dayjs(), datesOn = true, locale = 'en',
    dateMinutes = DEFAULT_DATE_MINUTES, digestMinutes = DEFAULT_DIGEST_MINUTES,
  }: { now?: Dayjs; datesOn?: boolean; locale?: string; dateMinutes?: number; digestMinutes?: number } = {},
): PeopleReminder[] {
  const active = people.filter(p => !p.archived)
  const byId = new Map(active.map(p => [p.sync_id, p]))
  return [
    ...(datesOn ? dateReminders(t, dates, byId, now, dateMinutes) : []),
    ...digestReminders(t, active, now, locale, digestMinutes),
  ]
}
