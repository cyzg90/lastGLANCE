// Wire shapes for People sync, shared by the file road (lastglance-people.json)
// and the vault road (the lastglance-people app). camelCase like the chore sync
// shapes. Every entity names its own `kind`: the vault app carries four entity
// types, and an explicit tag beats guessing from field names, which is what
// made chore-side `entityKind` fragile.

import { normalizeDirection } from '../types'
import type { Interaction, InteractionChannel, InteractionDirection, InteractionSource, Person, PersonCircle, PersonDate, PersonDateKind } from '../types'

export interface SyncPerson {
  kind: 'person'
  id: string
  name: string
  nickname: string | null
  circleSyncId: string | null
  targetCadenceDays: number | null
  preferredChannel: InteractionChannel | null
  details: string | null
  archived: boolean
  snoozedUntil: string | null
  // Optional: builds from before the field send people without it.
  notifyWhenOverdue?: boolean
  addToDayglanceWhenOverdue?: boolean
  sendToLifeglance?: boolean
  ownerUserSyncId: string | null
  createdAt: string
  updatedAt: string
}

export interface SyncInteraction {
  kind: 'interaction'
  id: string
  personSyncIds: string[]
  occurredAt: string
  channel: InteractionChannel
  // Always present on the wire, null when not recorded: JSON drops undefined
  // keys, so an absent field could not be told from a peer that lacks it.
  direction: InteractionDirection | null
  note: string | null
  source: InteractionSource
  updatedAt: string
}

export interface SyncPersonDate {
  kind: 'personDate'
  id: string
  personSyncId: string
  dateKind: PersonDateKind
  label: string | null
  month: number
  day: number
  year: number | null
  remindDaysBefore: number
  updatedAt: string
}

export interface SyncPersonCircle {
  kind: 'personCircle'
  id: string
  name: string
  icon: string | null
  sortOrder: number
  updatedAt: string
}

export type SyncPeopleEntity = SyncPerson | SyncInteraction | SyncPersonDate | SyncPersonCircle

export interface PeoplePayload {
  people: SyncPerson[]
  interactions: SyncInteraction[]
  personDates: SyncPersonDate[]
  personCircles: SyncPersonCircle[]
  tombstones: Record<string, string>   // sync_id → deletedAt ISO string
}

export const emptyPeoplePayload = (): PeoplePayload => ({
  people: [], interactions: [], personDates: [], personCircles: [], tombstones: {},
})

// ── Row ↔ wire mappings ──────────────────────────────────────────────────────

export function toSyncPerson(p: Person): SyncPerson {
  return {
    kind: 'person',
    id: p.sync_id,
    name: p.name,
    nickname: p.nickname,
    circleSyncId: p.circle_sync_id,
    targetCadenceDays: p.target_cadence_days,
    preferredChannel: p.preferred_channel,
    details: p.details,
    archived: p.archived,
    snoozedUntil: p.snoozed_until,
    notifyWhenOverdue: !!p.notify_when_overdue,
    addToDayglanceWhenOverdue: !!p.add_to_dayglance_when_overdue,
    sendToLifeglance: !!p.send_to_lifeglance,
    ownerUserSyncId: p.owner_user_sync_id,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }
}

export function fromSyncPerson(s: SyncPerson): Omit<Person, 'id'> {
  return {
    sync_id: s.id,
    name: s.name,
    nickname: s.nickname ?? null,
    circle_sync_id: s.circleSyncId ?? null,
    target_cadence_days: s.targetCadenceDays ?? null,
    preferred_channel: s.preferredChannel ?? null,
    details: s.details ?? null,
    archived: !!s.archived,
    snoozed_until: s.snoozedUntil ?? null,
    notify_when_overdue: !!s.notifyWhenOverdue,
    add_to_dayglance_when_overdue: !!s.addToDayglanceWhenOverdue,
    send_to_lifeglance: !!s.sendToLifeglance,
    owner_user_sync_id: s.ownerUserSyncId ?? null,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  }
}

export function toSyncInteraction(i: Interaction): SyncInteraction {
  return {
    kind: 'interaction',
    id: i.sync_id,
    personSyncIds: i.person_sync_ids,
    occurredAt: i.occurred_at,
    channel: i.channel,
    direction: normalizeDirection(i.direction),
    note: i.note,
    source: i.source,
    updatedAt: i.updated_at,
  }
}

export function fromSyncInteraction(s: SyncInteraction): Omit<Interaction, 'id'> {
  return {
    sync_id: s.id,
    person_sync_ids: [...s.personSyncIds],
    occurred_at: s.occurredAt,
    channel: s.channel,
    direction: normalizeDirection(s.direction),
    note: s.note ?? null,
    source: s.source,
    updated_at: s.updatedAt,
  }
}

export function toSyncPersonDate(d: PersonDate): SyncPersonDate {
  return {
    kind: 'personDate',
    id: d.sync_id,
    personSyncId: d.person_sync_id,
    dateKind: d.kind,
    label: d.label,
    month: d.month,
    day: d.day,
    year: d.year,
    remindDaysBefore: d.remind_days_before,
    updatedAt: d.updated_at,
  }
}

export function fromSyncPersonDate(s: SyncPersonDate): Omit<PersonDate, 'id'> {
  return {
    sync_id: s.id,
    person_sync_id: s.personSyncId,
    kind: s.dateKind,
    label: s.label ?? null,
    month: s.month,
    day: s.day,
    year: s.year ?? null,
    remind_days_before: s.remindDaysBefore ?? 0,
    updated_at: s.updatedAt,
  }
}

export function toSyncPersonCircle(c: PersonCircle): SyncPersonCircle {
  return {
    kind: 'personCircle',
    id: c.sync_id,
    name: c.name,
    icon: c.icon,
    sortOrder: c.sort_order,
    updatedAt: c.updated_at,
  }
}

export function fromSyncPersonCircle(s: SyncPersonCircle): Omit<PersonCircle, 'id'> {
  return {
    sync_id: s.id,
    name: s.name,
    icon: s.icon ?? null,
    sort_order: s.sortOrder,
    updated_at: s.updatedAt,
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
const CHANNELS = new Set(['in_person', 'call', 'video', 'text', 'email', 'other'])
const SOURCES = new Set(['manual', 'quick_action', 'intent'])
const DATE_KINDS = new Set(['birthday', 'anniversary', 'custom'])

function nameOk(v: unknown, max: number): boolean {
  return typeof v === 'string' && v.length > 0 && v.length <= max
}

// Returns why an entity is invalid, or null when it is fine. Used to drop bad
// rows on both roads rather than failing a whole sync on one of them.
export function invalidReason(e: SyncPeopleEntity): string | null {
  if (!e || typeof e !== 'object') return 'not an object'
  if (!uuidRe.test(e.id)) return 'invalid id'
  if (!isoRe.test(e.updatedAt)) return 'invalid updatedAt'
  switch (e.kind) {
    case 'person':
      if (!nameOk(e.name, 500)) return 'invalid person name'
      if (!isoRe.test(e.createdAt)) return 'invalid person createdAt'
      if (e.circleSyncId != null && !uuidRe.test(e.circleSyncId)) return 'invalid circleSyncId'
      if (e.targetCadenceDays != null && !(Number.isFinite(e.targetCadenceDays) && e.targetCadenceDays > 0)) return 'invalid targetCadenceDays'
      if (e.preferredChannel != null && !CHANNELS.has(e.preferredChannel)) return 'invalid preferredChannel'
      return null
    case 'interaction':
      if (!Array.isArray(e.personSyncIds) || e.personSyncIds.length === 0 || !e.personSyncIds.every(id => uuidRe.test(id))) return 'invalid personSyncIds'
      if (!isoRe.test(e.occurredAt)) return 'invalid occurredAt'
      if (!CHANNELS.has(e.channel)) return 'invalid channel'
      if (!SOURCES.has(e.source)) return 'invalid source'
      return null
    case 'personDate':
      if (!uuidRe.test(e.personSyncId)) return 'invalid personSyncId'
      if (!DATE_KINDS.has(e.dateKind)) return 'invalid dateKind'
      if (!Number.isInteger(e.month) || e.month < 1 || e.month > 12) return 'invalid month'
      if (!Number.isInteger(e.day) || e.day < 1 || e.day > 31) return 'invalid day'
      return null
    case 'personCircle':
      if (!nameOk(e.name, 200)) return 'invalid circle name'
      if (typeof e.sortOrder !== 'number') return 'invalid sortOrder'
      return null
    default:
      return 'unknown kind'
  }
}
