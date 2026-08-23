import { describe, it, expect, beforeAll } from 'vitest'
import { languages, loaders } from './locales'
import { EUROPEAN_ONLY, BRAZILIAN_ONLY, MARKER_CONSTRUCTIONS } from './ptMarkers'

// Which standard each shipped Portuguese locale must hold to. A bare "pt" is
// European because that is what this app's single locale has always been —
// and what it stays through the pt-PT/pt-BR split.
function expectedStandard(tag: string): { name: string; forbidden: Record<string, RegExp> } {
  if (tag === 'pt-BR') return { name: 'Brazilian', forbidden: EUROPEAN_ONLY }
  return { name: 'European', forbidden: BRAZILIAN_ONLY }
}

const portuguese = languages.filter((l) => l.split('-')[0] === 'pt')

describe('Portuguese variant purity', () => {
  const bundles: Record<string, Record<string, unknown>> = {}
  beforeAll(async () => {
    await Promise.all(
      portuguese.map(async (lng) => {
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

  it('ships at least one Portuguese locale', () => {
    expect(portuguese.length).toBeGreaterThan(0)
  })

  // A marker that cannot match its own name is a guardrail that passes because
  // it never fires — the worst kind. In dayGLANCE this is how the ASCII-\b bug
  // in /\becrã\b/ was found, after it had already let a stray "ecrã" through.
  it.each(Object.entries({ ...EUROPEAN_ONLY, ...BRAZILIAN_ONLY }))(
    'the %s pattern matches the word it is named for',
    (name, pattern) => {
      // Multi-word grammatical markers are named for the construction, not a
      // literal string, so they are exercised by the sample phrases instead.
      expect(pattern.test(MARKER_CONSTRUCTIONS[name] ?? name)).toBe(true)
    },
  )

  it.each(portuguese)('%s uses only its own standard', (lng) => {
    const { name, forbidden } = expectedStandard(lng)
    const strings = flatten(bundles[lng]).filter(([, v]) => typeof v === 'string') as [string, string][]
    const violations: string[] = []

    for (const [key, value] of strings) {
      for (const [marker, pattern] of Object.entries(forbidden)) {
        const found = value.match(pattern)
        if (found) violations.push(`  ${key}: "${found[0]}" — ${marker}\n      ${value.slice(0, 110)}`)
      }
    }

    expect(
      violations,
      `${lng} is meant to be ${name} Portuguese but ${violations.length} string(s) use the other standard:\n${violations.join('\n')}`,
    ).toEqual([])
  })
})
