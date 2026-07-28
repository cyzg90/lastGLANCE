import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// In-memory stand-in for the native SecureStore plugin. `available` is
// mutable so individual tests can exercise the non-Android no-op path.
const nativeStore = new Map<string, string>()
const availability = { value: true }
vi.mock('@/native/secureStore', () => ({
  get isSecureStoreAvailable() { return availability.value },
  secureGet: vi.fn(async (key: string) => (nativeStore.has(key) ? nativeStore.get(key)! : null)),
  secureSet: vi.fn(async (key: string, value: string) => { nativeStore.set(key, value) }),
  secureDelete: vi.fn(async (key: string) => { nativeStore.delete(key) }),
}))

// The vitest environment is node: no Storage / window / localStorage. The shim
// patches Storage.prototype and distinguishes localStorage from sessionStorage
// by identity, so the fixture must model both on a real prototype chain.
class FakeStorage {
  private store = new Map<string, string>()
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null }
  setItem(k: string, v: string): void { this.store.set(k, String(v)) }
  removeItem(k: string): void { this.store.delete(k) }
  clear(): void { this.store.clear() }
  key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null }
  get length(): number { return this.store.size }
}

const SECRET_KEY = 'lastglance-cloud-sync-config'

type ShimModule = typeof import('./secureConfigShim')
let shim: ShimModule

describe('secureConfigShim', () => {
  beforeEach(async () => {
    const g = globalThis as Record<string, unknown>
    g.Storage = FakeStorage
    g.localStorage = new FakeStorage()
    g.sessionStorage = new FakeStorage()
    g.window = globalThis
    nativeStore.clear()
    availability.value = true
    vi.resetModules()
    shim = await import('./secureConfigShim')
  })

  afterEach(() => {
    shim.uninstallSecureConfigShimForTests()
  })

  it('passes non-secret keys through to real localStorage', async () => {
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    localStorage.setItem('theme', 'dark')
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(nativeStore.size).toBe(0)
  })

  it('serves secret keys from the cache and writes through to the native store', async () => {
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    const cfg = JSON.stringify({ enabled: true, appPassword: 'hunter2' })
    localStorage.setItem(SECRET_KEY, cfg)
    // Synchronous read-back straight from the cache — this is the contract the
    // sync engine's synchronous getConfig() depends on.
    expect(localStorage.getItem(SECRET_KEY)).toBe(cfg)
    await shim.flushSecureWrites()
    expect(nativeStore.get(SECRET_KEY)).toBe(cfg)
    // The real localStorage must never have seen the value.
    shim.uninstallSecureConfigShimForTests()
    expect(localStorage.getItem(SECRET_KEY)).toBeNull()
  })

  it('removeItem clears both cache and native store', async () => {
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    localStorage.setItem(SECRET_KEY, 'v')
    localStorage.removeItem(SECRET_KEY)
    expect(localStorage.getItem(SECRET_KEY)).toBeNull()
    await shim.flushSecureWrites()
    expect(nativeStore.has(SECRET_KEY)).toBe(false)
  })

  it('migrates legacy plaintext out of localStorage on hydrate', async () => {
    const legacy = JSON.stringify({ vaultToken: 'tok_legacy' })
    localStorage.setItem('lastglance-vault-config', legacy)
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    // Served from the cache, present in the native store, gone from disk.
    expect(localStorage.getItem('lastglance-vault-config')).toBe(legacy)
    expect(nativeStore.get('lastglance-vault-config')).toBe(legacy)
    shim.uninstallSecureConfigShimForTests()
    expect(localStorage.getItem('lastglance-vault-config')).toBeNull()
  })

  it('hydrates previously stored secrets from the native store', async () => {
    nativeStore.set('lg_intents_config', '{"webdavPassword":"pw"}')
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    expect(localStorage.getItem('lg_intents_config')).toBe('{"webdavPassword":"pw"}')
  })

  it('a wiped native store (device transfer) reads as absent', async () => {
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    expect(localStorage.getItem(SECRET_KEY)).toBeNull()
  })

  it('does not touch sessionStorage', async () => {
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    sessionStorage.setItem(SECRET_KEY, 'session-value')
    expect(sessionStorage.getItem(SECRET_KEY)).toBe('session-value')
    await shim.flushSecureWrites()
    expect(nativeStore.size).toBe(0)
  })

  it('is a no-op when the secure store is unavailable (web / iOS)', async () => {
    availability.value = false
    shim.installSecureConfigShim()
    await shim.hydrateSecureConfig()
    localStorage.setItem(SECRET_KEY, 'plain')
    // Without the shim installed, behavior is the status quo: plain localStorage.
    expect(localStorage.getItem(SECRET_KEY)).toBe('plain')
    expect(nativeStore.size).toBe(0)
  })
})
