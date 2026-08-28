import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
