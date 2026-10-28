import dayjs from 'dayjs'

// Shared by both Journals (chores and People), so a range means the same days
// in each.

export type RangeKey = '7d' | '30d' | '90d' | 'year' | 'all' | 'custom'

export const RANGE_KEYS: RangeKey[] = ['7d', '30d', '90d', 'year', 'all', 'custom']

// Resolve a range choice to inclusive ISO bounds in the user's local timezone,
// so "last 7 days" means seven local days and day grouping lines up with what
// the rows show. An undefined bound is open-ended.
export function resolveRange(range: RangeKey, customFrom: string, customTo: string): { from?: string; to?: string } {
  const endOfToday = dayjs().endOf('day').toISOString()
  switch (range) {
    case '7d':   return { from: dayjs().subtract(6, 'day').startOf('day').toISOString(), to: endOfToday }
    case '30d':  return { from: dayjs().subtract(29, 'day').startOf('day').toISOString(), to: endOfToday }
    case '90d':  return { from: dayjs().subtract(89, 'day').startOf('day').toISOString(), to: endOfToday }
    case 'year': return { from: dayjs().startOf('year').toISOString(), to: endOfToday }
    case 'all':  return {}
    case 'custom': return {
      from: customFrom ? dayjs(customFrom).startOf('day').toISOString() : undefined,
      to: customTo ? dayjs(customTo).endOf('day').toISOString() : undefined,
    }
  }
}

export function csvCell(value: string): string {
  // Quote whenever the value could otherwise break the row, doubling any quote.
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
