import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CI cannot run Xcode, so the iOS version wiring is checked here.
 * MARKETING_VERSION (from package.json) and CURRENT_PROJECT_VERSION (from
 * IOS_BUILD) come through the gitignored ios/version.generated.xcconfig
 * (scripts/sync-ios-version.mjs), and reach every target through the
 * project-level base configurations. Either value in project.pbxproj would
 * override it for that target alone, and an object
 * section out of ID order is rewritten by Xcode on its next save, leaving the
 * committed file dirty on every machine that opens it.
 */
const IOS = join(__dirname, '../ios')
const pbx = readFileSync(join(IOS, 'App/App.xcodeproj/project.pbxproj'), 'utf8')

describe('iOS version wiring', () => {
  it.each(['MARKETING_VERSION', 'CURRENT_PROJECT_VERSION'])('leaves %s out of project.pbxproj', (key) => {
    expect(pbx).not.toContain(key)
  })

  it.each(['Debug', 'Release'])('bases the project %s configuration on an xcconfig that includes the version', (name) => {
    const list = pbx.match(/Build configuration list for PBXProject "App" \*\/ = \{[\s\S]*?\n\t\t\};/)![0]
    const id = list.match(new RegExp(`([0-9A-F]{24}) /\\* ${name} \\*/`))![1]
    const config = pbx.match(new RegExp(`\\t\\t${id} /\\* ${name} \\*/ = \\{[\\s\\S]*?\\n\\t\\t\\};`))![0]
    const file = config.match(/baseConfigurationReference = [0-9A-F]{24} \/\* (\S+\.xcconfig) \*\//)![1]
    expect(readFileSync(join(IOS, file), 'utf8')).toMatch(/^#include "version\.generated\.xcconfig"$/m)
  })

  it('keeps every object section in the ID order Xcode writes', () => {
    const unsorted = [...pbx.matchAll(/\/\* Begin (\w+) section \*\/\n([\s\S]*?)\/\* End/g)]
      .filter(([, , body]) => {
        const ids = [...body.matchAll(/^\t\t([0-9A-F]{24}) /gm)].map((m) => m[1])
        return ids.join() !== [...ids].sort().join()
      })
      .map(([, name]) => name)
    expect(unsorted).toEqual([])
  })
})
