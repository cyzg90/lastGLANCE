// The incoming log_interaction intent (docs: the People spec, Intents), pure:
// read the payload and find the person. handleIntent does the logging, so a
// Tasker profile or another GLANCE app can record a contact.
//
// Payload: { name | person_id, channel?, direction?, note?, occurred_at?, event_id? }
// `name` matches a name or nickname exactly (ignoring case), else a unique
// part of a name. `channel` defaults to the person's preferred one, else
// "other". `event_id` makes a re-fired intent log once.

import dayjs from 'dayjs'
import { INTERACTION_CHANNELS, normalizeDirection } from './types'
import type { InteractionChannel, InteractionDirection, Person } from './types'

export interface LogInteractionRequest {
  name: string | null
  personId: string | null
  channel: InteractionChannel | null
  direction: InteractionDirection | null
  note: string | null
  occurredAt: string | null
  eventId: string | null
}

// Words automation tends to send for a channel.
const CHANNEL_ALIASES: Record<string, InteractionChannel> = {
  phone: 'call', voice: 'call', sms: 'text', message: 'text', mms: 'text', chat: 'text',
  facetime: 'video', video_call: 'video', videocall: 'video',
  inperson: 'in_person', 'in-person': 'in_person', meet: 'in_person', visit: 'in_person',
  mail: 'email', 'e-mail': 'email',
}

const DIRECTION_ALIASES: Record<string, InteractionDirection> = {
  outgoing: 'outbound', out: 'outbound', incoming: 'inbound', in: 'inbound', both: 'mutual',
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function parseLogInteraction(payload: unknown): { ok: true; request: LogInteractionRequest } | { ok: false; error: string } {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const name = str(p.name)
  const personId = str(p.person_id)
  if (!name && !personId) return { ok: false, error: 'log_interaction needs a name or person_id' }

  let channel: InteractionChannel | null = null
  const rawChannel = str(p.channel)?.toLowerCase()
  if (rawChannel) {
    channel = (INTERACTION_CHANNELS as readonly string[]).includes(rawChannel)
      ? rawChannel as InteractionChannel
      : CHANNEL_ALIASES[rawChannel] ?? null
    if (!channel) return { ok: false, error: `Unknown channel "${rawChannel}"; use ${INTERACTION_CHANNELS.join(', ')}` }
  }

  let direction: InteractionDirection | null = null
  const rawDirection = str(p.direction)?.toLowerCase()
  if (rawDirection) {
    direction = normalizeDirection(rawDirection) ?? DIRECTION_ALIASES[rawDirection] ?? null
    if (!direction) return { ok: false, error: `Unknown direction "${rawDirection}"; use outbound, inbound or mutual` }
  }

  const occurredAt = str(p.occurred_at)
  if (occurredAt && !dayjs(occurredAt).isValid()) return { ok: false, error: `Invalid occurred_at "${occurredAt}"` }

  return {
    ok: true,
    request: {
      name, personId, channel, direction,
      note: str(p.note),
      occurredAt: occurredAt ? dayjs(occurredAt).toISOString() : null,
      eventId: str(p.event_id),
    },
  }
}

export type PersonMatch =
  | { kind: 'one'; person: Person; fuzzy: boolean }
  | { kind: 'none' }
  | { kind: 'ambiguous'; count: number }

// Archived people are left out: logging is for the people you keep up with.
export function matchPerson(people: Person[], request: Pick<LogInteractionRequest, 'name' | 'personId'>): PersonMatch {
  const active = people.filter(p => !p.archived)
  if (request.personId) {
    const byId = active.find(p => p.sync_id === request.personId)
    return byId ? { kind: 'one', person: byId, fuzzy: false } : { kind: 'none' }
  }
  const needle = (request.name ?? '').toLowerCase()
  const exact = active.filter(p => p.name.trim().toLowerCase() === needle || p.nickname?.trim().toLowerCase() === needle)
  if (exact.length === 1) return { kind: 'one', person: exact[0], fuzzy: false }
  if (exact.length > 1) return { kind: 'ambiguous', count: exact.length }
  const partial = active.filter(p => p.name.toLowerCase().includes(needle))
  if (partial.length === 1) return { kind: 'one', person: partial[0], fuzzy: true }
  if (partial.length > 1) return { kind: 'ambiguous', count: partial.length }
  return { kind: 'none' }
}
