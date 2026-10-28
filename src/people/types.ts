import type { ReciprocitySignals } from './reciprocity'

// People mode data model (docs: the People spec). Every synced row carries a
// sync_id and updated_at, like chores. Rows reference each other by sync_id
// only, never by Dexie's local auto-increment id, so remote rows can land in
// any order without the deferral machinery the chore tables need.

export type InteractionChannel = 'in_person' | 'call' | 'video' | 'text' | 'email' | 'other'

export const INTERACTION_CHANNELS: readonly InteractionChannel[] = [
  'in_person', 'call', 'video', 'text', 'email', 'other',
]

export type InteractionSource = 'manual' | 'quick_action' | 'intent'

// Who started an interaction (docs: the reciprocity spec). `mutual` is a
// planned-together event with no initiator; null is "not recorded", which
// covers legacy rows, imports and logs where the user skipped the control.
// Only outbound and inbound count toward reciprocity signals.
export type InteractionDirection = 'outbound' | 'inbound' | 'mutual'

export const INTERACTION_DIRECTIONS: readonly InteractionDirection[] = ['outbound', 'inbound', 'mutual']

// Unknown or absent values (a row from before the field, or a value a newer
// build added) read as not recorded.
export function normalizeDirection(value: unknown): InteractionDirection | null {
  return value === 'outbound' || value === 'inbound' || value === 'mutual' ? value : null
}

export type PersonDateKind = 'birthday' | 'anniversary' | 'custom'

export interface Person {
  id?: number
  sync_id: string
  name: string
  nickname: string | null
  circle_sync_id: string | null
  target_cadence_days: number | null
  preferred_channel: InteractionChannel | null
  details: string | null
  archived: boolean
  snoozed_until: string | null
  // One line in the daily People digest once overdue (docs: the People spec,
  // Reminders). Off by default, like the chore flag. Optional because rows
  // from before the field lack it; absent reads as off.
  notify_when_overdue?: boolean
  // GLANCE intents (docs: the People spec, Intents), both off by default and
  // absent on older rows. Once past due, a "Call Sam" task goes to dayGLANCE;
  // each contact logged with them goes to the lifeGLANCE timeline.
  add_to_dayglance_when_overdue?: boolean
  send_to_lifeglance?: boolean
  // The household user this person belongs to. Other members' People are
  // hidden in the UI (not cryptographically private). Null when multi-user is
  // off, which reads as "mine" on every device.
  owner_user_sync_id: string | null
  created_at: string
  updated_at: string
}

export interface Interaction {
  id?: number
  sync_id: string
  // One interaction can cover several people (a dinner with three friends).
  person_sync_ids: string[]
  occurred_at: string
  channel: InteractionChannel
  // Not indexed, so rows from before the field simply lack it; read it
  // through normalizeDirection.
  direction?: InteractionDirection | null
  note: string | null
  source: InteractionSource
  updated_at: string
}

export interface PersonDate {
  id?: number
  sync_id: string
  person_sync_id: string
  kind: PersonDateKind
  label: string | null
  month: number   // 1-12
  day: number     // 1-31
  year: number | null
  remind_days_before: number
  updated_at: string
}

export interface PersonCircle {
  id?: number
  sync_id: string
  name: string
  icon: string | null
  sort_order: number
  updated_at: string
}

// Device-local link from a person to a phone contact. Contact ids differ on
// every device, so this table never syncs.
export interface ContactLink {
  person_sync_id: string
  device_contact_key: string
  last_synced_at: string
}

export interface PeopleTombstone {
  id: string
  deleted_at: string
}

export interface PersonWithLastInteraction extends Person {
  last_interaction_at: string | null
  last_channel: InteractionChannel | null
  last_direction: InteractionDirection | null
  // Days since the last interaction, or since the person was added when there
  // is none yet, so a bulk import does not read as everyone overdue.
  elapsed_days: number
  // Who has been reaching out, over the reciprocity window.
  reciprocity: ReciprocitySignals
}
