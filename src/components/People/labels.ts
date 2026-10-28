import type { TFunction } from 'i18next'
import type { ReachOutItem } from '@/people/home'
import type { PersonDate } from '@/people/types'

export function dateKindLabel(t: TFunction, date: Pick<PersonDate, 'kind' | 'label'>): string {
  if (date.kind === 'custom' && date.label) return date.label
  return t(`people.dateKind.${date.kind}`)
}

export function daysUntilLabel(t: TFunction, daysUntil: number): string {
  if (daysUntil === 0) return t('nextDue.today')
  if (daysUntil === 1) return t('nextDue.tomorrow')
  return t('nextDue.inDays', { count: daysUntil })
}

// The one line a Reach out card shows about why someone is there, or null.
// Shared with the Reach out widget (src/people/widgetSnapshot.ts).
export function reachOutReasonLabel(t: TFunction, { person, reason }: ReachOutItem): string | null {
  if (!reason) return null
  if (reason.kind === 'date') return `${dateKindLabel(t, reason.upcoming.date)} · ${daysUntilLabel(t, reason.upcoming.daysUntil)}`
  if (reason.kind === 'unreturned') return t('people.reason.unreturned', { name: person.nickname || person.name })
  return t('people.reason.streak', { count: reason.count })
}
