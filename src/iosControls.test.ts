import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The router is exercised for real below, so the native bridge it calls is
// stubbed. vi.hoisted because vi.mock is lifted above ordinary declarations.
const { plugin } = vi.hoisted(() => ({
  plugin: {
    consumeDeepLink: vi.fn(async () => ({ deepLink: null as string | null })),
    consumeSharedChore: vi.fn(async () => ({ text: null as string | null })),
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'ios' },
  registerPlugin: () => plugin,
}))

import { routeWidgetDeepLink } from '@/native/pendingDeepLink'

/**
 * CI cannot run Xcode, so the project wiring the Control Center control
 * depends on is validated here.
 *
 * A control button can only trigger an AppIntent, and iOS resolves that intent
 * against the *app's* AppIntents metadata when deciding whether it may open the
 * app. An intent compiled into the widget extension alone is invisible there,
 * and the tap does nothing at all: no launch, no error, nothing to debug from.
 * That is how AddChoreControl shipped, living in GlanceWidgets/AccessoryWidgets.swift.
 *
 * Chaining OpenURLIntent (which the intent does, and should keep doing) is not
 * a substitute for the membership. Both are required, which is the trap: the
 * code reads as though the OpenURLIntent alone is enough.
 *
 * Nothing else catches this. It is not a compile error, and the accessory
 * widget in the same original file genuinely cannot join the app target, since
 * it depends on the extension-only SnapshotProvider.
 *
 * OPENING THE APP AND SAYING WHERE TO GO ARE SEPARATE PROBLEMS, and the second
 * regressed on its own once the first was fixed: with the membership in place
 * `openAppWhenRun` foregrounds the app, which can satisfy "open" without the
 * system ever performing the chained OpenURLIntent — so the app arrived on the
 * chore list with no destination. The intent therefore writes the pending token
 * itself, and the tests below follow that token all the way to the web event,
 * because every layer of that chain is a plain literal no compiler checks.
 */
const IOS = join(__dirname, '../ios/App')
const PBXPROJ = join(IOS, 'App.xcodeproj/project.pbxproj')

const APP_TARGET = 'App'
const WIDGET_TARGET = 'GlanceWidgetsExtension'
const CONTROL_FILE = 'AddChoreControl.swift'

/** Map each native target to the file names in its Sources build phase. */
function sourcesByTarget(pbx: string): Record<string, string[]> {
  const phases: Record<string, string[]> = {}
  const phaseRe = /([0-9A-F]{24}) \/\* Sources \*\/ = \{\s*isa = PBXSourcesBuildPhase;([\s\S]*?)\n\t\t\};/g
  for (const m of pbx.matchAll(phaseRe)) {
    phases[m[1]] = [...m[2].matchAll(/\/\* (.+?) in Sources \*\//g)].map((f) => f[1])
  }

  const out: Record<string, string[]> = {}
  const targetRe = /([0-9A-F]{24}) \/\* ([A-Za-z]+) \*\/ = \{\s*isa = PBXNativeTarget;([\s\S]*?)\n\t\t\};/g
  for (const m of pbx.matchAll(targetRe)) {
    const files: string[] = []
    for (const ph of m[3].matchAll(/([0-9A-F]{24}) \/\* Sources \*\//g)) {
      files.push(...(phases[ph[1]] ?? []))
    }
    out[m[2]] = files
  }
  return out
}

describe('iOS Control Center control', () => {
  const pbx = readFileSync(PBXPROJ, 'utf8')
  const targets = sourcesByTarget(pbx)

  it('parses both targets out of the project file', () => {
    expect(Object.keys(targets)).toEqual(expect.arrayContaining([APP_TARGET, WIDGET_TARGET]))
    expect(targets[APP_TARGET].length).toBeGreaterThan(0)
    expect(targets[WIDGET_TARGET].length).toBeGreaterThan(0)
  })

  it.each([APP_TARGET, WIDGET_TARGET])('compiles %s into the control file', (target) => {
    expect(
      targets[target],
      `${CONTROL_FILE} must be a member of BOTH ${APP_TARGET} and ${WIDGET_TARGET}. ` +
        'An intent the app target cannot see will not open the app, and the control ' +
        'silently does nothing when tapped.',
    ).toContain(CONTROL_FILE)
  })

  it('defines the control and its intent in that shared file', () => {
    const src = readFileSync(join(IOS, 'App/Shared', CONTROL_FILE), 'utf8')
    expect(src).toMatch(/struct OpenAddChoreIntent: AppIntent/)
    expect(src).toMatch(/struct AddChoreControl: ControlWidget/)
    // The OpenURLIntent chain is the other half of what makes the tap work.
    expect(src).toMatch(/OpenURLIntent/)
  })

  it('does not let the control drift back into the extension-only file', () => {
    const accessory = readFileSync(join(IOS, 'GlanceWidgets/AccessoryWidgets.swift'), 'utf8')
    expect(accessory).not.toMatch(/struct AddChoreControl: ControlWidget/)
    expect(accessory).not.toMatch(/struct OpenAddChoreIntent: AppIntent/)
  })

  it('still registers the control in the widget bundle', () => {
    const bundle = readFileSync(join(IOS, 'GlanceWidgets/GlanceWidgetsBundle.swift'), 'utf8')
    expect(bundle).toMatch(/AddChoreControl\(\)/)
  })
})

// ── The destination, from the intent to the web event ────────────────────────
//
// The control opening the app is only half the job. Nothing about "and it opens
// the new-chore form" is checked by a compiler, a type, or the Swift build: the
// token is a bare string that has to survive an App Group write, an AppDelegate
// URL mapping, a Capacitor bridge call and a web-router branch, each of which
// spells it out as its own literal. These tests read the token out of the Swift
// intent and follow that exact value through every remaining layer, so any one
// of them drifting fails here rather than on someone's phone.
describe('iOS Control Center destination', () => {
  const src = readFileSync(join(IOS, 'App/Shared', CONTROL_FILE), 'utf8')

  /** The token the intent writes, and the URL it chains — from source. */
  const token = src.match(/writePendingDeepLink\("([^"]+)"\)/)?.[1]
  const url = src.match(/OpenURLIntent\(URL\(string: "([^"]+)"\)!\)/)?.[1]

  beforeEach(() => {
    vi.clearAllMocks()
    plugin.consumeDeepLink.mockResolvedValue({ deepLink: null })
    plugin.consumeSharedChore.mockResolvedValue({ text: null })
  })

  it('writes the pending token itself, rather than relying on the chained URL', () => {
    expect(
      token,
      'OpenAddChoreIntent.perform() must write the deep-link token. `openAppWhenRun` ' +
        'foregrounds the app carrying no destination, and once it has satisfied "open the ' +
        'app" the system need not perform the chained OpenURLIntent — so the URL is not a ' +
        'reliable carrier. Without this write the control opens the app on the chore list.',
    ).toBe('action:add')
  })

  it('keeps the chained URL, and AppDelegate maps it back to the same token', () => {
    // Not redundant with the write: when the system DOES perform it, this is
    // the path the URL takes, and it must land on the same single slot.
    expect(url).toBe('lastglance://action/add')

    // Mirror AppDelegate.deepLinkToken's parse: host, then lastPathComponent.
    const { host, pathname } = new URL(url!)
    const last = pathname.split('/').filter(Boolean).pop()

    const delegate = readFileSync(join(IOS, 'App/AppDelegate.swift'), 'utf8')
    expect(delegate).toMatch(new RegExp(`case "${host}":`))
    expect(delegate).toMatch(new RegExp(`case "${last}": return "${token}"`))
  })

  it('is accepted by the quick-action validity check too', () => {
    // The same token arrives from home-screen quick actions, which validate
    // against an explicit allow-list. A token the control writes but that list
    // rejects would work from one entry point and not the other.
    const delegate = readFileSync(join(IOS, 'App/AppDelegate.swift'), 'utf8')
    expect(delegate).toContain(`token == "${token}"`)
  })

  it('routes that exact token to the new-chore form', async () => {
    // The web half, run for real: the router is driven with the token read out
    // of the Swift source, not with a literal re-typed here.
    const dispatched: string[] = []
    vi.stubGlobal('window', { dispatchEvent: (e: Event) => { dispatched.push(e.type); return true } })
    plugin.consumeDeepLink.mockResolvedValue({ deepLink: token! })

    await routeWidgetDeepLink()

    expect(dispatched).toContain('lg:new-chore')
    vi.unstubAllGlobals()
  })

  it('has a listener for that event mounted in the Ribbon', () => {
    // The last link in the chain, and the only one not executable here: the
    // Ribbon owns the new-chore form and registers the listener on mount.
    const ribbon = readFileSync(join(__dirname, 'components/Ribbon/Ribbon.tsx'), 'utf8')
    expect(ribbon).toContain("addEventListener('lg:new-chore'")
  })
})
