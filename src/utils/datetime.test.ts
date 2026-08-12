import { describe, it, expect, afterEach } from 'vitest'
import dayjs from 'dayjs'
import {
  applyDateLocale,
  getActiveLocale,
  formatDate,
  formatTime,
  formatDayHeading,
  formatMonthDay,
  formatMonthYear,
  firstDayOfWeek,
  weekdayMinLabels,
  weekdayAtOffset,
} from './datetime'

// A Wednesday, deliberately in the afternoon so the 12-/24-hour split shows.
const SAMPLE = '2026-08-12T14:05:00'

afterEach(() => applyDateLocale('en'))

describe('applyDateLocale', () => {
  it('accepts the six supported languages', () => {
    for (const lng of ['en', 'de', 'es', 'fr', 'it', 'pt']) {
      applyDateLocale(lng)
      expect(getActiveLocale()).toBe(lng)
    }
  })

  it('takes the base language from a regional tag', () => {
    applyDateLocale('pt-BR')
    expect(getActiveLocale()).toBe('pt')
  })

  it('falls back to English for anything unsupported or absent', () => {
    for (const lng of ['ja', 'xx-YY', '', undefined]) {
      applyDateLocale(lng)
      expect(getActiveLocale()).toBe('en')
    }
  })
})

describe('display formatting', () => {
  it('localizes the month name and field order', () => {
    applyDateLocale('en')
    expect(formatDate(SAMPLE)).toBe('Aug 12, 2026')
    applyDateLocale('fr')
    // Day precedes month in French, and the month name is translated.
    expect(formatDate(SAMPLE)).toMatch(/12/)
    expect(formatDate(SAMPLE)).toMatch(/août/)
    expect(formatDate(SAMPLE).indexOf('12')).toBeLessThan(formatDate(SAMPLE).indexOf('août'))
  })

  it('uses a 12-hour clock in English and a 24-hour clock elsewhere', () => {
    applyDateLocale('en')
    expect(formatTime(SAMPLE)).toMatch(/2:05\s?PM/i)
    for (const lng of ['de', 'es', 'fr', 'it', 'pt']) {
      applyDateLocale(lng)
      const time = formatTime(SAMPLE)
      expect(time).toContain('14')
      expect(time).not.toMatch(/[AP]M/i)
    }
  })

  it('localizes weekday and month names in the day heading', () => {
    applyDateLocale('en')
    expect(formatDayHeading(SAMPLE)).toMatch(/Wednesday/)
    applyDateLocale('fr')
    expect(formatDayHeading(SAMPLE)).toMatch(/mercredi/)
    applyDateLocale('de')
    expect(formatDayHeading(SAMPLE)).toMatch(/Mittwoch/)
  })

  it('orders the short month-and-day form per locale', () => {
    applyDateLocale('en')
    expect(formatMonthDay(SAMPLE)).toBe('Aug 12')
    applyDateLocale('fr')
    // "12 août", never "août 12" — the reason this does not use a fixed token.
    expect(formatMonthDay(SAMPLE)).toMatch(/^12/)
  })

  it('localizes the month-and-year label', () => {
    applyDateLocale('en')
    expect(formatMonthYear(SAMPLE)).toBe('August 2026')
    applyDateLocale('es')
    expect(formatMonthYear(SAMPLE).toLowerCase()).toContain('agosto')
  })

  it('re-formats after a locale change rather than serving a cached formatter', () => {
    applyDateLocale('en')
    const english = formatDate(SAMPLE)
    applyDateLocale('de')
    expect(formatDate(SAMPLE)).not.toBe(english)
    applyDateLocale('en')
    expect(formatDate(SAMPLE)).toBe(english)
  })
})

describe('week start', () => {
  it('starts the week on Sunday in English and Monday in the others', () => {
    applyDateLocale('en')
    expect(firstDayOfWeek()).toBe(0)
    for (const lng of ['de', 'es', 'fr', 'it', 'pt']) {
      applyDateLocale(lng)
      expect(firstDayOfWeek()).toBe(1)
    }
  })

  it('moves dayjs arithmetic with it, which is what the grids are built from', () => {
    applyDateLocale('en')
    expect(dayjs(SAMPLE).startOf('week').day()).toBe(0)
    applyDateLocale('fr')
    expect(dayjs(SAMPLE).startOf('week').day()).toBe(1)
  })

  it('rotates the weekday labels to match that week order', () => {
    applyDateLocale('en')
    expect(weekdayMinLabels()).toHaveLength(7)
    expect(weekdayMinLabels()[0]).toBe('Su')
    applyDateLocale('fr')
    const fr = weekdayMinLabels()
    expect(fr).toHaveLength(7)
    expect(fr[0]).toBe('lu') // Monday leads, and the label is French
    expect(fr[6]).toBe('di')
  })

  it('reports the real weekday for a row offset, so labels land on the right rows', () => {
    applyDateLocale('en')
    // Sunday-start: row 1 is Monday.
    expect(weekdayAtOffset(1).weekday).toBe(1)
    applyDateLocale('fr')
    // Monday-start: Monday is row 0 instead.
    expect(weekdayAtOffset(0).weekday).toBe(1)
    expect(weekdayAtOffset(6).weekday).toBe(0)
  })
})
