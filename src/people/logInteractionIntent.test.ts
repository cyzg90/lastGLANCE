import { describe, it, expect, vi } from 'vitest'
import { matchPerson, parseLogInteraction } from './logInteractionIntent'
import { handleIntent, type IntentContext } from '@/intents/handleIntent'
import { BROADCAST_ACTION_MAP, LG_ANDROID_ACTIONS, LOG_INTERACTION } from '@/intents/androidIntents'
import type { Person } from './types'

function person(sync_id: string, name: string, over: Partial<Person> = {}): Person {
  return {
    sync_id, name, nickname: null, circle_sync_id: null, target_cadence_days: 14, preferred_channel: null,
    details: null, archived: false, snoozed_until: null, owner_user_sync_id: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ...over,
  }
}

const SAM = person('p-sam', 'Sam Lee', { preferred_channel: 'text' })
const DAD = person('p-dad', 'Robert Smith', { nickname: 'Dad' })
const SAMIRA = person('p-samira', 'Samira Khan')
const OLD = person('p-old', 'Old Friend', { archived: true })
const PEOPLE = [SAM, DAD, SAMIRA, OLD]

describe('parseLogInteraction', () => {
  it('needs a name or person_id', () => {
    expect(parseLogInteraction({})).toEqual({ ok: false, error: 'log_interaction needs a name or person_id' })
  })

  it('accepts channel and direction words automation tends to send', () => {
    const r = parseLogInteraction({ name: 'Dad', channel: 'Phone', direction: 'incoming' })
    expect(r.ok && r.request).toMatchObject({ channel: 'call', direction: 'inbound' })
  })

  it('rejects an unknown channel, direction or time', () => {
    expect(parseLogInteraction({ name: 'Dad', channel: 'pigeon' }).ok).toBe(false)
    expect(parseLogInteraction({ name: 'Dad', direction: 'sideways' }).ok).toBe(false)
    expect(parseLogInteraction({ name: 'Dad', occurred_at: 'yesterday-ish' }).ok).toBe(false)
  })
})

describe('matchPerson', () => {
  it('matches a nickname or name exactly, ignoring case', () => {
    expect(matchPerson(PEOPLE, { name: 'dad', personId: null })).toEqual({ kind: 'one', person: DAD, fuzzy: false })
    expect(matchPerson(PEOPLE, { name: 'SAM LEE', personId: null })).toEqual({ kind: 'one', person: SAM, fuzzy: false })
  })

  it('takes a unique part of a name as fuzzy, and refuses an ambiguous one', () => {
    expect(matchPerson(PEOPLE, { name: 'khan', personId: null })).toEqual({ kind: 'one', person: SAMIRA, fuzzy: true })
    expect(matchPerson(PEOPLE, { name: 'sam', personId: null })).toEqual({ kind: 'ambiguous', count: 2 })
  })

  it('leaves archived people out', () => {
    expect(matchPerson(PEOPLE, { name: 'Old Friend', personId: null })).toEqual({ kind: 'none' })
  })
})

describe('handleIntent log_interaction', () => {
  function ctx(over: Partial<IntentContext> = {}): IntentContext {
    return {
      listPeople: vi.fn(async () => PEOPLE),
      interactionExists: vi.fn(async () => false),
      logInteraction: vi.fn(async () => ({ sync_id: 'new-i' })),
      ...over,
    }
  }

  it('maps the Android action to log_interaction', () => {
    expect(BROADCAST_ACTION_MAP[LG_ANDROID_ACTIONS.LOG_INTERACTION]).toBe(LOG_INTERACTION)
  })

  it('logs on the preferred channel with the direction given', async () => {
    const c = ctx()
    const r = await handleIntent(LOG_INTERACTION, { name: 'Sam Lee', direction: 'inbound', note: 'Missed call' }, c)
    expect(r).toEqual({ success: true, person_id: SAM.sync_id, interaction_id: 'new-i' })
    expect(c.logInteraction).toHaveBeenCalledWith({
      person_sync_ids: [SAM.sync_id], channel: 'text', direction: 'inbound', note: 'Missed call', source: 'intent',
    })
  })

  it('logs once for a repeated event_id', async () => {
    const c = ctx({ interactionExists: vi.fn(async () => true) })
    const r = await handleIntent(LOG_INTERACTION, { name: 'Dad', event_id: 'tasker-1' }, c)
    expect(r).toMatchObject({ success: true, interaction_id: 'tasker-1', warning: 'Already logged; not duplicated' })
    expect(c.logInteraction).not.toHaveBeenCalled()
  })

  it('uses the event_id as the interaction id, and "other" without a preferred channel', async () => {
    const c = ctx()
    await handleIntent(LOG_INTERACTION, { person_id: DAD.sync_id, event_id: 'tasker-2', occurred_at: '2026-10-14T09:30:00Z' }, c)
    expect(c.logInteraction).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'other', sync_id: 'tasker-2', occurred_at: '2026-10-14T09:30:00.000Z',
    }))
  })

  it('reports no match and ambiguity as errors', async () => {
    expect(await handleIntent(LOG_INTERACTION, { name: 'Nobody' }, ctx())).toEqual({ success: false, error: 'No person matches "Nobody"' })
    expect((await handleIntent(LOG_INTERACTION, { name: 'sam' }, ctx())).success).toBe(false)
  })

  it('warns on a fuzzy match', async () => {
    const r = await handleIntent(LOG_INTERACTION, { name: 'Khan' }, ctx())
    expect(r.warning).toBe('Fuzzy-matched "Khan" to "Samira Khan"')
  })
})
