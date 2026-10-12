import 'fake-indexeddb/auto'
import { afterAll, describe, expect, it, vi } from 'vitest'

// krelltunez/dayGLANCE#2037: a WebDAV cycle whose upload failed still stamped
// "Last synced" and reported success, so a device whose writes never reached
// the server looked synced forever. Fixed in @glance-apps/sync 2.1.1; this walks
// lastGLANCE's own createEngine so a later package bump cannot quietly bring
// the masking back.

const store = new Map<string, string>()
const originalLocalStorage = globalThis.localStorage
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size },
} as Storage
afterAll(() => { globalThis.localStorage = originalLocalStorage })

const { createEngine } = await import('./engine')

const LAST_SYNCED_KEY = 'lastglance-cloud-sync-last-synced'

describe('WebDAV cycle with a failing upload (krelltunez/dayGLANCE#2037)', () => {
  it('seeding an empty remote: the error is reported and "Last synced" does not advance', async () => {
    const calls = { status: [] as string[], lastSynced: [] as string[], errors: [] as (string | null)[] }
    const engine = createEngine(undefined, {
      onStatusChange: (s) => { calls.status.push(s) },
      onError: (msg, code) => { if (msg) calls.errors.push(code) },
      onLastSyncedChange: (iso) => { calls.lastSynced.push(iso) },
      onPassphraseRequired: () => {},
    })
    // createEngine seeds last-synced so the engine skips the first-sync conflict
    // path; that seeded value is what must survive a failed cycle.
    const seeded = localStorage.getItem(LAST_SYNCED_KEY)
    expect(seeded).toBeTruthy()

    const provider = {
      name: 'fake', configFields: [],
      download: vi.fn(async () => null),
      upload: vi.fn(async () => { throw new Error('Upload failed: 409 Conflict') }),
      test: vi.fn(),
    }
    const providers = engine.providers as Record<string, unknown>
    Object.keys(providers).forEach((k) => delete providers[k])
    providers.fake = provider
    localStorage.setItem('lastglance-cloud-sync-config', JSON.stringify({ enabled: true, provider: 'fake' }))

    vi.useFakeTimers()
    const p = engine.download()
    await vi.advanceTimersByTimeAsync(3000)
    await p
    vi.useRealTimers()

    expect(provider.upload).toHaveBeenCalled()
    expect(localStorage.getItem(LAST_SYNCED_KEY)).toBe(seeded)
    expect(calls.lastSynced).toEqual([])
    expect(calls.status).toContain('error')
    expect(calls.status).not.toContain('success')
    expect(calls.errors.length).toBeGreaterThan(0)
  })
})
