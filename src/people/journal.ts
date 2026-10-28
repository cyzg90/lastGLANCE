// The People side of the header heatmap and the Journal (docs: the People
// spec, Journal and heatmap): logged interactions instead of chore
// completions, limited to the people this household member can see.

import dayjs from 'dayjs'
import type { Interaction, Person } from './types'

// Interactions that cover at least one visible person, with everyone else
// dropped from them, so another member's people never show up by name.
export function visibleInteractions(interactions: Interaction[], visible: Pick<Person, 'sync_id'>[]): Interaction[] {
  const ids = new Set(visible.map(p => p.sync_id))
  const out: Interaction[] = []
  for (const i of interactions) {
    const people = i.person_sync_ids.filter(id => ids.has(id))
    if (people.length === 0) continue
    out.push(people.length === i.person_sync_ids.length ? i : { ...i, person_sync_ids: people })
  }
  return out
}

// Interactions per local day (YYYY-MM-DD). A dinner with three friends is one
// interaction, so it counts once.
export function interactionCountsByDay(interactions: Interaction[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const i of interactions) {
    const day = dayjs(i.occurred_at).format('YYYY-MM-DD')
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return counts
}

export function inRange(i: Pick<Interaction, 'occurred_at'>, from?: string, to?: string): boolean {
  const at = dayjs(i.occurred_at)
  if (from && at.isBefore(dayjs(from))) return false
  if (to && at.isAfter(dayjs(to))) return false
  return true
}
