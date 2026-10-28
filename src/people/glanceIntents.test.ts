import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import type { TFunction } from 'i18next'
import {
  dateItem, datesToday, MILESTONE_ENTITY_TYPE, overdueEpisode, peopleDueForTask, reachOutTask, reachOutTaskTitle,
  timelineEntry,
} from './glanceIntents'
import { NO_SIGNALS } from './reciprocity'
import type { Interaction, PersonDate, PersonWithLastInteraction } from './types'

// Echoes the key and its options, so tests read which string was chosen.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key} ${JSON.stringify(opts)}` : key) as unknown as TFunction

const NOW = dayjs('2026-10-14T15:00:00')

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

function interaction(over: Partial<Interaction> = {}): Interaction {
  return {
    sync_id: 'i1', person_sync_ids: [], occurred_at: '2026-10-13T20:00:00', channel: 'call',
    direction: null, note: null, source: 'manual', updated_at: '2026-10-13T20:00:00', ...over,
  }
}

const overdue = (over: Partial<PersonWithLastInteraction> = {}) => person({
  add_to_dayglance_when_overdue: true, target_cadence_days: 7, last_interaction_at: '2026-10-01T12:00:00', ...over,
})

describe('peopleDueForTask', () => {
  it('picks opted-in people past due', () => {
    const due = overdue()
    const notYet = overdue({ last_interaction_at: '2026-10-12T12:00:00' })
    const optedOut = overdue({ add_to_dayglance_when_overdue: false })
    const noCadence = overdue({ target_cadence_days: null })
    expect(peopleDueForTask([due, notYet, optedOut, noCadence], NOW, () => null)).toEqual([due])
  })

  it('leaves out archived and snoozed people', () => {
    const archived = overdue({ archived: true })
    const snoozed = overdue({ snoozed_until: '2026-10-20T00:00:00' })
    expect(peopleDueForTask([archived, snoozed], NOW, () => null)).toEqual([])
  })

  it('sends once per overdue stretch, and again after a new contact runs late', () => {
    const p = overdue()
    const sent = { [p.sync_id]: overdueEpisode(p) }
    expect(peopleDueForTask([p], NOW, id => sent[id] ?? null)).toEqual([])
    const later = { ...p, last_interaction_at: '2026-10-05T12:00:00' }
    expect(peopleDueForTask([later], NOW, id => sent[id] ?? null)).toEqual([later])
  })

  it('counts someone never contacted from when they were added', () => {
    const p = overdue({ last_interaction_at: null, created_at: '2026-10-01T00:00:00' })
    expect(peopleDueForTask([p], NOW, () => null)).toEqual([p])
    expect(overdueEpisode(p)).toBe('added:2026-10-01T00:00:00')
  })
})

describe('reachOutTaskTitle', () => {
  it('words the task by channel, with the nickname', () => {
    expect(reachOutTaskTitle(t, person({ name: 'Robert Smith', nickname: 'Dad', preferred_channel: 'call' })))
      .toBe('people.intents.task.call {"name":"Dad"}')
  })

  it('says "back" when their reaching out is unreturned', () => {
    const p = person({ name: 'Dad', preferred_channel: 'call', reciprocity: { ...NO_SIGNALS, unreturned: true } })
    expect(reachOutTaskTitle(t, p)).toBe('people.intents.task.callBack {"name":"Dad"}')
  })

  it('falls back to the last channel, then to a plain reach out', () => {
    expect(reachOutTaskTitle(t, person({ name: 'A', last_channel: 'text' }))).toBe('people.intents.task.text {"name":"A"}')
    expect(reachOutTaskTitle(t, person({ name: 'B' }))).toBe('people.intents.task.other {"name":"B"}')
  })

  it('builds an all-day task for today keyed to the person', () => {
    const p = person({ name: 'Sam', preferred_channel: 'video' })
    expect(reachOutTask(t, p, NOW)).toEqual({
      title: 'people.intents.task.video {"name":"Sam"}', due: '2026-10-14', all_day: true, source_entity_id: p.sync_id,
    })
  })
})

describe('today\'s dates', () => {
  function date(personId: string, month: number, day: number, over: Partial<PersonDate> = {}): PersonDate {
    return {
      sync_id: `d-${personId}-${month}-${day}`, person_sync_id: personId, kind: 'birthday', label: null,
      month, day, year: null, remind_days_before: 0, updated_at: '2026-01-01T00:00:00.000Z', ...over,
    }
  }

  it('lists only dates falling today, for people not archived', () => {
    const sam = person({ name: 'Sam' })
    const gone = person({ archived: true })
    const today = date(sam.sync_id, 10, 14, { year: 1986 })
    const found = datesToday([today, date(sam.sync_id, 10, 15), date(gone.sync_id, 10, 14)], [sam, gone], NOW)
    expect(found.map(u => u.date)).toEqual([today])
  })

  it('sends one as an all-day item named for the person, keyed to the date and year', () => {
    const sam = person({ name: 'Sam' })
    const [u] = datesToday([date(sam.sync_id, 10, 14, { year: 1986 })], [sam], NOW)
    expect(dateItem(t, u)).toEqual({
      title: 'people.intents.dateTitle {"name":"Sam","label":"people.dateKind.birthday (40)"}',
      due: '2026-10-14',
      all_day: true,
      source_entity_id: `d-${sam.sync_id}-10-14:2026`,
    })
  })
})

describe('timelineEntry', () => {
  const sam = person({ name: 'Sam', send_to_lifeglance: true })
  const leo = person({ name: 'Leo' })

  it('sends nothing when no one on it is opted in', () => {
    expect(timelineEntry(t, interaction({ person_sync_ids: [leo.sync_id] }), [sam, leo], 'en')).toBeNull()
  })

  it('carries the direction in the title and the channel and note in the notes', () => {
    const e = timelineEntry(t, interaction({ person_sync_ids: [sam.sync_id], direction: 'inbound', note: 'The trip' }), [sam], 'en')
    expect(e).toEqual({
      title: 'people.intents.timeline.inbound {"names":"Sam"}',
      due: '2026-10-13',
      all_day: true,
      notes: 'people.channel.call · The trip',
      source_entity_id: 'i1',
      entity_type: MILESTONE_ENTITY_TYPE,
    })
  })

  it('names everyone on a group contact, and reads no direction as catching up', () => {
    const e = timelineEntry(t, interaction({ person_sync_ids: [sam.sync_id, leo.sync_id], channel: 'in_person' }), [sam, leo], 'en')
    expect(e?.title).toBe('people.intents.timeline.mutual {"names":"Sam and Leo"}')
    expect(e?.notes).toBe('people.channel.in_person')
  })
})
