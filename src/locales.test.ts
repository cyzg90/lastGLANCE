import { describe, it, expect, beforeAll } from 'vitest'
import { languages, loaders, resolveLanguage } from './locales'

// de/es/fr/it/pt sat 8 keys behind en — the backup restore confirmation and
// the GLANCEvault intents errors rendered in English for every non-English
// user. The backlog is translated, so this is a strict parity check: a key
// added to en without translations fails here instead of silently falling back.
describe('locale bundles', () => {
  const EXPECTED = ['de', 'en', 'es', 'fr', 'it', 'pt-BR', 'pt-PT']
  const TRANSLATED = EXPECTED.filter((l) => l !== 'en')

  const bundles: Record<string, Record<string, unknown>> = {}
  beforeAll(async () => {
    await Promise.all(
      EXPECTED.map(async (lng) => {
        bundles[lng] = await loaders[lng]()
      }),
    )
  })

  const flatten = (obj: Record<string, unknown>, prefix = ''): [string, unknown][] =>
    Object.entries(obj).flatMap(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k
      return v && typeof v === 'object' && !Array.isArray(v)
        ? flatten(v as Record<string, unknown>, key)
        : [[key, v] as [string, unknown]]
    })

  const keysOf = (lng: string) => new Set(flatten(bundles[lng]).map(([k]) => k))

  it('exposes every shipped language', () => {
    expect(languages).toEqual(EXPECTED)
  })

  // Shared by the detector (convertDetectedLanguage) and the picker's value —
  // the two must agree, or the UI renders one language while the picker
  // displays another.
  describe('resolveLanguage', () => {
    it('passes through a tag that is already shipped', () => {
      expect(resolveLanguage('de')).toBe('de')
      expect(resolveLanguage('pt-BR')).toBe('pt-BR')
    })

    it('matches a shipped tag regardless of case', () => {
      expect(resolveLanguage('DE')).toBe('de')
      expect(resolveLanguage('pt-br')).toBe('pt-BR')
      expect(resolveLanguage('PT-BR')).toBe('pt-BR')
    })

    // The regression the pt split must not cause. Portuguese shipped as a
    // single "pt" locale (European) before the split, so every Portuguese
    // user has that value cached in localStorage; without the mapping they
    // would silently land in English.
    it('moves the pre-split "pt" to European rather than English', () => {
      expect(resolveLanguage('pt')).toBe('pt-PT')
    })

    it('sends an unshipped Portuguese region to European', () => {
      expect(resolveLanguage('pt-AO')).toBe('pt-PT')
      expect(resolveLanguage('pt-MZ')).toBe('pt-PT')
    })

    it('reduces a regional tag to a base language that is shipped', () => {
      expect(resolveLanguage('en-US')).toBe('en')
      expect(resolveLanguage('de-AT')).toBe('de')
    })

    it('falls back to en for a language that is not shipped', () => {
      expect(resolveLanguage('ja')).toBe('en')
      expect(resolveLanguage('zz-ZZ')).toBe('en')
    })

    it('handles a missing or non-string value', () => {
      expect(resolveLanguage(undefined)).toBe('en')
      expect(resolveLanguage(null)).toBe('en')
      expect(resolveLanguage('')).toBe('en')
      expect(resolveLanguage(42)).toBe('en')
    })

    it('prefers any variant of the right language over English', () => {
      expect(resolveLanguage('pt', ['en', 'pt-BR'])).toBe('pt-BR')
    })

    it('falls back to the first option when en is not shipped', () => {
      expect(resolveLanguage('ja', ['de', 'fr'])).toBe('de')
    })

    it('always returns something the picker can render', () => {
      for (const reported of ['en', 'pt', 'pt-AO', 'de-AT', 'zz', '', undefined]) {
        expect(languages).toContain(resolveLanguage(reported))
      }
    })
  })

  it.each(EXPECTED)('%s resolves to a non-empty bundle', (lng) => {
    expect(bundles[lng]).toBeTypeOf('object')
    expect(Object.keys(bundles[lng]).length).toBeGreaterThan(0)
  })

  describe('coverage against en', () => {
    it.each(TRANSLATED)('%s covers every key in en', (lng) => {
      const missing = [...keysOf('en')].filter((k) => !keysOf(lng).has(k))
      expect(
        missing,
        `${lng} is missing keys that en has — translate them:\n  ${missing.slice(0, 10).join('\n  ')}`,
      ).toEqual([])
    })

    it.each(TRANSLATED)('%s carries no keys that en does not', (lng) => {
      const extra = [...keysOf(lng)].filter((k) => !keysOf('en').has(k))
      expect(extra, `${lng} has keys absent from en`).toEqual([])
    })
  })

  // Same keys is not enough: an interpolation slot dropped or misspelled in a
  // translation renders as literal "{{name}}" (or loses the value) only in
  // that language, which no English-side test would ever see.
  describe('placeholder parity with en', () => {
    const slotsOf = (value: unknown): string[] =>
      typeof value === 'string' ? (value.match(/\{\{\s*[^}]+?\s*\}\}/g) ?? []).map((s) => s.replace(/\s/g, '')).sort() : []

    it.each(TRANSLATED)('%s keeps every {{placeholder}} en uses', (lng) => {
      const en = new Map(flatten(bundles.en))
      const mismatched = flatten(bundles[lng])
        .filter(([key, value]) => en.has(key) && slotsOf(value).join() !== slotsOf(en.get(key)).join())
        .map(([key, value]) => `  ${key}: [${slotsOf(en.get(key))}] became [${slotsOf(value)}]`)
      expect(mismatched, `${lng} placeholder mismatches:\n${mismatched.join('\n')}`).toEqual([])
    })
  })

  // pt-BR is generated from pt-PT by scripts/gen-pt-br.mjs — never edited by
  // hand. Regenerate to a scratch path and diff against the committed file, so
  // a pt-PT edit that was not followed by `node scripts/gen-pt-br.mjs` (or a
  // hand edit to pt-BR that regeneration would overwrite) fails here.
  it('pt-BR is exactly the transform of pt-PT', async () => {
    const { execFileSync } = await import('node:child_process')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { readFileSync } = await import('node:fs')
    const out = join(tmpdir(), `pt-br-regen-${process.pid}.json`)
    execFileSync('node', ['scripts/gen-pt-br.mjs', out])
    const regenerated = JSON.parse(readFileSync(out, 'utf8'))
    expect(
      bundles['pt-BR'],
      'pt-BR does not match its transform — run `node scripts/gen-pt-br.mjs` (and never edit pt-BR by hand)',
    ).toEqual(regenerated)
  })

  // Parity can be satisfied by pasting the English text in. Spot-check one
  // string from each of the two backlog sections for actual translation.
  describe('backlog keys are actually translated', () => {
    const SAMPLES = ['backup.areYouSureBody', 'integration.vaultIntentsNoConnection']
    const get = (lng: string, key: string): unknown =>
      key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], bundles[lng])

    it.each(TRANSLATED.flatMap((lng) => SAMPLES.map((key) => [lng, key])))(
      '%s translates %s',
      (lng, key) => {
        expect(get(lng, key), `${lng} is missing ${key}`).toBeTypeOf('string')
        expect(get(lng, key), `${lng} left ${key} in English`).not.toBe(get('en', key))
      },
    )
  })
})
