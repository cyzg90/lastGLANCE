import { describe, it, expect } from 'vitest'
import { anyIntentsTransportOn, intentsTransportsOn } from './intentsAvailable'

describe('intents availability', () => {
  it('any one transport is enough', () => {
    expect(anyIntentsTransportOn({ webdav: false, vault: false, directAccess: false })).toBe(false)
    expect(anyIntentsTransportOn({ webdav: true, vault: false, directAccess: false })).toBe(true)
    expect(anyIntentsTransportOn({ webdav: false, vault: true, directAccess: false })).toBe(true)
    expect(anyIntentsTransportOn({ webdav: false, vault: false, directAccess: true })).toBe(true)
  })

  it('Direct Access counts only with its opt-in on and a folder connected', () => {
    const store = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } } })
    try {
      expect(intentsTransportsOn({ supported: true, connected: true }).directAccess).toBe(false)
      store.set('lg_direct_access_intents_enabled', 'true')
      expect(intentsTransportsOn({ supported: true, connected: true }).directAccess).toBe(true)
      expect(intentsTransportsOn({ supported: true, connected: false }).directAccess).toBe(false)
      expect(intentsTransportsOn({ supported: false, connected: false }).directAccess).toBe(false)
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })
})
