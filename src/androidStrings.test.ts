import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CI cannot compile the Android app, but the string resources are plain XML —
 * so the mistakes that would break the next local build (or silently ship
 * English) are checked here instead: a locale carrying a key the base file
 * doesn't have (aapt error), a %1$d placeholder dropped in translation
 * (runtime crash on getString with args), an unescaped apostrophe (aapt
 * error), or a translatable key missing from a locale (silently English).
 */
const RES = join(__dirname, '../android/app/src/main/res')

// Brand and configuration values, deliberately base-only.
const UNTRANSLATED = new Set(['app_name', 'title_activity_main', 'package_name', 'custom_url_scheme'])

function parseStrings(path: string): Map<string, string> {
  const xml = readFileSync(path, 'utf8')
  const out = new Map<string, string>()
  for (const m of xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)) {
    out.set(m[1], m[2])
  }
  return out
}

const base = parseStrings(join(RES, 'values/strings.xml'))
const locales = readdirSync(RES).filter((d) => /^values-[a-z]{2}(-r[A-Z]{2})?$/.test(d))
const placeholders = (v: string) => (v.match(/%\d\$[sd]/g) ?? []).sort().join(',')

describe('Android string resources', () => {
  it('found the locale directories', () => {
    expect(locales.length).toBeGreaterThanOrEqual(5)
  })

  it.each(locales)('%s carries no keys absent from the base file', (loc) => {
    const strings = parseStrings(join(RES, loc, 'strings.xml'))
    expect(strings.size).toBeGreaterThan(0)
    const extra = [...strings.keys()].filter((k) => !base.has(k))
    expect(extra, `${loc} has keys aapt would reject`).toEqual([])
  })

  it.each(locales)('%s translates every translatable key', (loc) => {
    const strings = parseStrings(join(RES, loc, 'strings.xml'))
    const missing = [...base.keys()].filter((k) => !UNTRANSLATED.has(k) && !strings.has(k))
    expect(missing, `${loc} would silently render these in English`).toEqual([])
  })

  it.each(locales)('%s keeps every format placeholder', (loc) => {
    const strings = parseStrings(join(RES, loc, 'strings.xml'))
    const mismatched = [...strings]
      .filter(([k, v]) => placeholders(v) !== placeholders(base.get(k) ?? ''))
      .map(([k]) => k)
    expect(mismatched, `${loc} placeholder mismatches crash getString at runtime`).toEqual([])
  })

  it.each(locales)('%s escapes apostrophes for aapt', (loc) => {
    const strings = parseStrings(join(RES, loc, 'strings.xml'))
    const bad = [...strings].filter(([, v]) => /(^|[^\\])'/.test(v)).map(([k]) => k)
    expect(bad, `${loc} unescaped apostrophes fail the resource compile`).toEqual([])
  })
})
