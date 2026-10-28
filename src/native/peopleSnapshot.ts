// The `people` block of the widget snapshot (docs: the People spec, Widgets):
// what the Reach out and Coming up widgets and the iOS next-birthday Lock
// Screen widget draw. Pure, so the contract is testable; snapshot.ts loads the
// data.
//
// Text that only the app knows how to word (date kinds, reasons, "last
// contact") is baked in the app's language here, so the native side needs no
// copy of the People strings. Dates go as plain local days and the widgets
// count the days themselves, so "tomorrow" stays right across midnight
// without a fresh push; `labels` carries the words they build that from.

import type { TFunction } from 'i18next'
import type { Dayjs } from 'dayjs'
import { formatElapsed, getCadenceColor } from '@/utils/cadence'
import { cadenceRatio, reachOutList, upcomingDates } from '@/people/home'
import type { PersonDate, PersonWithLastInteraction } from '@/people/types'
import { dateKindLabel, reachOutReasonLabel } from '@/components/People/labels'

// Five on the list, as the spec says; more dates than any widget shows, so
// one that passes before the next push still leaves the widget full.
export const WIDGET_REACH_OUT = 5
export const WIDGET_COMING_UP = 10
// The bar colour for someone on Reach out for a date alone, with no cadence:
// the pink the Coming up tiles use.
const DATE_COLOR = '#f472b6'
const SENTINEL = 987654

export interface SnapshotReachOut {
  syncId: string
  name: string
  // Elapsed over cadence, unclamped; null with no cadence.
  ratio: number | null
  color: string
  // The card's reason line, else when they were last in touch.
  detail: string
}

export interface SnapshotDate {
  personSyncId: string
  name: string
  // "Birthday (40)", or the custom label.
  label: string
  // The local day it falls on, YYYY-MM-DD.
  on: string
}

export interface PeopleSnapshot {
  reachOut: SnapshotReachOut[]
  comingUp: SnapshotDate[]
  labels: {
    reachOut: string
    comingUp: string
    reachOutEmpty: string
    comingUpEmpty: string
    today: string
    tomorrow: string
    // Contains {{count}} for the widget to fill in.
    inDays: string
  }
}

export function buildPeopleSnapshot(
  t: TFunction,
  people: PersonWithLastInteraction[],
  dates: PersonDate[],
  now: Dayjs,
  showReciprocity: boolean,
): PeopleSnapshot {
  const active = people.filter(p => !p.archived)

  const reachOut = reachOutList(active, dates, now, { limit: WIDGET_REACH_OUT, showReciprocity }).map(item => {
    const p = item.person
    const ratio = cadenceRatio(p)
    const last = p.last_interaction_at
      ? t('people.detail.lastContact', { last: formatElapsed(t, p.elapsed_days, p.last_interaction_at) })
      : t('people.row.noContactYet')
    return {
      syncId: p.sync_id,
      name: p.name,
      ratio: ratio !== null ? Math.round(ratio * 100) / 100 : null,
      color: ratio !== null ? getCadenceColor(ratio) : DATE_COLOR,
      detail: reachOutReasonLabel(t, item) ?? last,
    }
  })

  const comingUp = upcomingDates(dates, active, now).slice(0, WIDGET_COMING_UP).map(u => ({
    personSyncId: u.person.sync_id,
    name: u.person.name,
    label: `${dateKindLabel(t, u.date)}${u.turning !== null ? ` (${u.turning})` : ''}`,
    on: u.on.format('YYYY-MM-DD'),
  }))

  return {
    reachOut,
    comingUp,
    labels: {
      reachOut: t('people.home.reachOut'),
      comingUp: t('people.home.comingUp'),
      reachOutEmpty: t('people.home.reachOutEmpty'),
      comingUpEmpty: t('people.home.comingUpEmpty'),
      today: t('nextDue.today'),
      tomorrow: t('nextDue.tomorrow'),
      // Rendered with a sentinel, then the placeholder put back for native.
      // The key has no plural forms, so the sentinel picks no wrong one.
      inDays: t('nextDue.inDays', { count: SENTINEL }).replace(String(SENTINEL), '{{count}}'),
    },
  }
}
