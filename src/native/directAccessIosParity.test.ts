import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The iOS plugin is not compiled in CI, so a method added to the TS interface
// but not registered in DirectAccessPlugin.swift would only fail on a device
// (Capacitor rejects an unregistered method). This holds the two together:
// every method the iOS bridge calls is registered, and the Swift Slot enum
// names exactly the slots the bridge passes.

const root = resolve(__dirname, '../..')
const swift = readFileSync(resolve(root, 'ios/App/App/plugins/DirectAccessPlugin.swift'), 'utf8')
const ts = readFileSync(resolve(root, 'src/native/directAccess.ts'), 'utf8')

// Android-only: files by path below the picked folder.
const ANDROID_ONLY = new Set(['listFiles', 'readFile', 'writeFile', 'deleteFileAt', 'makeDir'])

function tsPluginMethods(): string[] {
  const body = ts.slice(ts.indexOf('export interface DirectAccessPluginType {'))
  const block = body.slice(0, body.indexOf('\n}'))
  return [...block.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1])
}

function swiftRegistered(): string[] {
  const start = swift.indexOf('public let pluginMethods')
  const block = swift.slice(start, swift.indexOf('].map', start))
  return [...block.matchAll(/"(\w+)"/g)].map((m) => m[1])
}

describe('DirectAccessPlugin.swift matches the bridge', () => {
  it('registers every method the iOS bridge can call', () => {
    const registered = new Set(swiftRegistered())
    const missing = tsPluginMethods().filter((m) => !ANDROID_ONLY.has(m) && !registered.has(m))
    expect(missing).toEqual([])
  })

  it('implements every method it registers', () => {
    const missing = swiftRegistered().filter((m) => !new RegExp(`@objc func ${m}\\(`).test(swift))
    expect(missing).toEqual([])
  })

  it('has exactly the slots the bridge passes', () => {
    const tsSlots = /export type DirectAccessSlot = ([^\n]+)/.exec(ts)![1].match(/'(\w+)'/g)!.map((s) => s.slice(1, -1))
    const swiftSlots = /enum Slot: String \{\s*case ([^\n]+)/.exec(swift)![1].split(',').map((s) => s.trim())
    expect(swiftSlots.sort()).toEqual(tsSlots.sort())
  })

  it('names People\'s file as the People WebDAV engine does', () => {
    expect(swift).toContain('case .people: return "lastglance-people.json"')
  })
})
