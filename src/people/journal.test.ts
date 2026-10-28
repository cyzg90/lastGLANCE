import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import { inRange, interactionCountsByDay, visibleInteractions } from './journal'
import type { Interaction } from './types'

function interaction(over: Partial<Interaction> = {}): Interaction {
  return {
    sync_id: crypto.randomUUID(),
    person_sync_ids: ['a'],
    occurred_at: dayjs('2026-10-10T12:00:00').toISOString(),
    channel: 'call',
    direction: null,
    note: null,
    source: 'manual',
    updated_at: dayjs('2026-10-10T12:00:00').toISOString(),
    ...over,
  }
}

describe('visibleInteractions', () => {
  it('drops interactions with nobody visible and hides other members\' people', () => {
    const mine = interaction({ person_sync_ids: ['a'] })
    const shared = interaction({ person_sync_ids: ['a', 'x'] })
    const theirs = interaction({ person_sync_ids: ['x'] })
    const out = visibleInteractions([mine, shared, theirs], [{ sync_id: 'a' }])
    expect(out.map(i => i.sync_id)).toEqual([mine.sync_id, shared.sync_id])
    expect(out[0]).toBe(mine)
    expect(out[1].person_sync_ids).toEqual(['a'])
  })
})

describe('interactionCountsByDay', () => {
  it('counts interactions per local day, once each however many people', () => {
    const counts = interactionCountsByDay([
      interaction({ person_sync_ids: ['a', 'b', 'c'] }),
      interaction({ occurred_at: dayjs('2026-10-10T20:00:00').toISOString() }),
      interaction({ occurred_at: dayjs('2026-10-11T08:00:00').toISOString() }),
    ])
    expect(counts.get('2026-10-10')).toBe(2)
    expect(counts.get('2026-10-11')).toBe(1)
    expect(counts.size).toBe(2)
  })
})

describe('inRange', () => {
  const i = interaction()
  it('treats missing bounds as open', () => {
    expect(inRange(i)).toBe(true)
  })
  it('includes the bounds and excludes outside', () => {
    expect(inRange(i, dayjs('2026-10-10').startOf('day').toISOString(), dayjs('2026-10-10').endOf('day').toISOString())).toBe(true)
    expect(inRange(i, dayjs('2026-10-11').startOf('day').toISOString())).toBe(false)
    expect(inRange(i, undefined, dayjs('2026-10-09').endOf('day').toISOString())).toBe(false)
  })
})
