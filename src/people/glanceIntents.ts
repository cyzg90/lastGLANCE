// People over GLANCE intents (docs: the People spec, Intents). Pure: which
// people and dates go out, and the words and payloads they go out as.
// usePeopleIntents does the sending; handleIntent takes log_interaction in.
//
// Out to dayGLANCE: a "Call Sam" task for each opted-in person once they are
// past due, and each of today's birthdays and dates as an all-day item. Out
// to lifeGLANCE: each contact logged with an opted-in person, as a timeline
// entry (a milestone) on the day it happened.

import type { TFunction } from 'i18next'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { dueDate, isSnoozed, upcomingDates, type UpcomingDate } from './home'
import { listFormat } from './reminders'
import type { CreateFields } from '@/intents/emitter'
import type { Interaction, InteractionChannel, PersonDate, PersonWithLastInteraction } from './types'
import { dateKindLabel } from '@/components/People/labels'

// dayGLANCE treats a CREATE as a task unless entity_type says otherwise, and
// lifeGLANCE takes this one as a timeline milestone. Not in the shared
// package's ENTITY_TYPES yet, so spelled out here.
export const MILESTONE_ENTITY_TYPE = 'milestone'

// What a person is called on a task: "Call Dad" reads right where "Call
// Robert Smith" does not, so the nickname wins.
function shortName(p: Pick<PersonWithLastInteraction, 'name' | 'nickname'>): string {
  return p.nickname?.trim() || p.name
}

// ── dayGLANCE: reach-out tasks ───────────────────────────────────────────────

// The episode a task belongs to: the last contact it is overdue from. One
// task per stretch overdue, not one a day; a new contact starts a new stretch.
export function overdueEpisode(p: PersonWithLastInteraction): string {
  return p.last_interaction_at ?? `added:${p.created_at}`
}

// Who should get a task now: opted in, with a cadence, not archived or
// snoozed, past due, and not already sent for this stretch.
export function peopleDueForTask(
  people: PersonWithLastInteraction[],
  now: Dayjs,
  sentEpisode: (syncId: string) => string | null,
): PersonWithLastInteraction[] {
  return people.filter(p => {
    if (!p.add_to_dayglance_when_overdue || p.archived || isSnoozed(p, now)) return false
    const due = dueDate(p)
    if (!due || due.isAfter(now)) return false
    return sentEpisode(p.sync_id) !== overdueEpisode(p)
  })
}

// The task's words follow the channel (preferred, else the last one used)
// and whether they are waiting on you: "Call Dad back" when the last contact
// was them reaching out and you have not answered, "Call Dad" otherwise.
export function reachOutTaskTitle(t: TFunction, p: PersonWithLastInteraction): string {
  const channel: InteractionChannel = p.preferred_channel ?? p.last_channel ?? 'other'
  const back = p.reciprocity.unreturned
  return t(`people.intents.task.${channel}${back ? 'Back' : ''}`, { name: shortName(p) })
}

export function reachOutTask(t: TFunction, p: PersonWithLastInteraction, now: Dayjs): CreateFields {
  return {
    title: reachOutTaskTitle(t, p),
    due: now.format('YYYY-MM-DD'),
    all_day: true,
    source_entity_id: p.sync_id,
  }
}

// ── dayGLANCE: today's dates ─────────────────────────────────────────────────

export function datesToday(dates: PersonDate[], people: PersonWithLastInteraction[], now: Dayjs): UpcomingDate[] {
  return upcomingDates(dates, people, now, 0)
}

// "Sam: Birthday (40)". The id is the date's own plus the year, so next
// year's is a new item rather than a repeat of this one.
export function dateItem(t: TFunction, u: UpcomingDate): CreateFields {
  const label = `${dateKindLabel(t, u.date)}${u.turning !== null ? ` (${u.turning})` : ''}`
  return {
    title: t('people.intents.dateTitle', { name: u.person.name, label }),
    due: u.on.format('YYYY-MM-DD'),
    all_day: true,
    source_entity_id: `${u.date.sync_id}:${u.on.year()}`,
  }
}

// ── lifeGLANCE: timeline entries ─────────────────────────────────────────────

// One entry per interaction, when anyone on it is opted in. The title carries
// the direction ("Reached out to Sam", "Sam reached out", "Caught up with
// Sam"); the notes carry the channel and the interaction's own note.
export function timelineEntry(
  t: TFunction,
  interaction: Interaction,
  people: Pick<PersonWithLastInteraction, 'sync_id' | 'name' | 'nickname' | 'send_to_lifeglance'>[],
  locale: string,
): CreateFields | null {
  const byId = new Map(people.map(p => [p.sync_id, p]))
  const on = interaction.person_sync_ids.map(id => byId.get(id)).filter(p => p !== undefined)
  if (!on.some(p => p.send_to_lifeglance)) return null
  const names = listFormat(locale, on.map(p => p.name))
  const direction = interaction.direction ?? 'mutual'
  const title = direction === 'outbound'
    ? t('people.intents.timeline.outbound', { names })
    : direction === 'inbound'
      ? t('people.intents.timeline.inbound', { names })
      : t('people.intents.timeline.mutual', { names })
  const channel = t(`people.channel.${interaction.channel}`)
  const note = interaction.note?.trim()
  return {
    title,
    due: dayjs(interaction.occurred_at).format('YYYY-MM-DD'),
    all_day: true,
    notes: note ? `${channel} · ${note}` : channel,
    source_entity_id: interaction.sync_id,
    entity_type: MILESTONE_ENTITY_TYPE,
  }
}
