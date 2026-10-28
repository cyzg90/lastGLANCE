// Pure rules for phone contacts in People (docs: the People spec, Contacts
// integration and privacy): reading contact dates, matching people to
// contacts by name on a second phone, and noticing a changed birthday. The
// native side is src/native/contacts.ts.

import type { ContactLink, PersonDate, PersonDateKind, PersonWithLastInteraction } from './types'
import type { DeviceContactSummary, RawContactEvent } from '@/native/contacts'

export interface ContactDate {
  kind: PersonDateKind
  label: string | null
  month: number
  day: number
  year: number | null
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
// Apple stores a birthday without a year as 1604; it reaches Android through
// iCloud and CardDAV sync.
const NO_YEAR_PLACEHOLDER = 1604

// Contact dates come as "1990-05-17", "--05-17" (no year), "19900517", or with
// a time after the date. Anything else is skipped rather than guessed.
export function parseContactEvent(e: RawContactEvent): ContactDate | null {
  const m = /^(?:(\d{4})|--)-?(\d{2})-?(\d{2})(?:$|[T ])/.exec(e.date.trim())
  if (!m) return null
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null
  let year: number | null = m[1] ? Number(m[1]) : null
  if (year === NO_YEAR_PLACEHOLDER || year === 0) year = null
  const kind: PersonDateKind = e.type === 3 ? 'birthday' : e.type === 1 ? 'anniversary' : 'custom'
  const label = kind === 'custom' ? (e.label?.trim() || null) : null
  return { kind, label, month, day, year }
}

// A contact's dates, parsed, with duplicates (the same date synced from two
// accounts) merged, keeping the year when either copy has one.
export function contactDates(events: RawContactEvent[]): ContactDate[] {
  const byId = new Map<string, ContactDate>()
  for (const e of events) {
    const d = parseContactEvent(e)
    if (!d) continue
    const id = `${d.kind}|${d.label ?? ''}|${d.month}|${d.day}`
    const prev = byId.get(id)
    if (!prev || (prev.year === null && d.year !== null)) byId.set(id, d)
  }
  return [...byId.values()]
}

export function sameDate(a: Pick<ContactDate, 'month' | 'day' | 'year'>, b: Pick<ContactDate, 'month' | 'day' | 'year'>): boolean {
  return a.month === b.month && a.day === b.day && (a.year ?? null) === (b.year ?? null)
}

function normalizeName(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

// On a second phone, links are rebuilt by name. A person is offered a contact
// only when exactly one contact has their name (ignoring case, spacing and
// accents), so two "Sam"s are never guessed between.
export function matchByName(
  people: PersonWithLastInteraction[],
  contacts: DeviceContactSummary[],
  links: ContactLink[],
): { person: PersonWithLastInteraction; contact: DeviceContactSummary }[] {
  const linked = new Set(links.map(l => l.person_sync_id))
  const takenKeys = new Set(links.map(l => l.device_contact_key))
  const byName = new Map<string, DeviceContactSummary[]>()
  for (const c of contacts) {
    if (takenKeys.has(c.key)) continue
    const n = normalizeName(c.name)
    byName.set(n, [...(byName.get(n) ?? []), c])
  }
  const out: { person: PersonWithLastInteraction; contact: DeviceContactSummary }[] = []
  for (const p of people) {
    if (p.archived || linked.has(p.sync_id)) continue
    const hits = byName.get(normalizeName(p.name))
    if (hits?.length === 1) out.push({ person: p, contact: hits[0] })
  }
  return out
}

// A birthday that differs between a person and their linked contact. Offered
// as an update, never applied silently. A person with no birthday is left
// alone: they may have removed it on purpose.
export function birthdayChange(personDates: PersonDate[], contactEvents: RawContactEvent[]): {
  date: PersonDate
  next: ContactDate
} | null {
  const date = personDates.find(d => d.kind === 'birthday')
  if (!date) return null
  const next = contactDates(contactEvents).find(d => d.kind === 'birthday')
  if (!next || sameDate(date, next)) return null
  return { date, next }
}

// The contact dates a person does not already have, for the offer when
// linking an existing person.
export function newDates(personDates: PersonDate[], dates: ContactDate[]): ContactDate[] {
  return dates.filter(d => !personDates.some(p =>
    p.kind === d.kind && p.month === d.month && p.day === d.day && (d.kind !== 'custom' || (p.label ?? null) === d.label)))
}
