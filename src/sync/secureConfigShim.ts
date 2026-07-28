import { isSecureStoreAvailable, secureDelete, secureGet, secureSet } from '@/native/secureStore'

// Keeps credential-bearing config out of localStorage on Android (issue #210)
// without touching any of the ~20 call sites that read it synchronously —
// including `@glance-apps/sync`, whose engine hard-codes
// `localStorage.getItem(...)` for its config key with no storage injection
// point. The only way its reads can hit a secure backend is to interpose on
// Storage itself, so that is exactly (and only) what this does:
//
// - `installSecureConfigShim()` patches Storage.prototype get/set/removeItem.
//   For an allow-list of secret keys on `window.localStorage`, reads are served
//   from an in-memory session cache and writes go to the cache plus a
//   write-through to the native SecureStore. Every other key, and everything on
//   sessionStorage, passes through untouched.
// - `hydrateSecureConfig()` runs once at boot, before React renders (and
//   therefore before the sync engine's first read): it migrates any legacy
//   plaintext value out of real localStorage into the SecureStore (one-time,
//   idempotent), then seeds the cache from the SecureStore.
//
// Known limits, deliberate: property-style access (`localStorage['k']`),
// enumeration (`length`/`key(i)`) and `clear()` are not intercepted — no
// consumer of these keys uses them (engine and app code use the method API
// throughout). On non-Android platforms neither function does anything, so
// behavior there is byte-for-byte the status quo.

// Every localStorage key whose value contains a credential. The engine-owned
// names are `${storageKeyPrefix}-cloud-sync-config` / `-db-sync-config` with
// prefix 'lastglance' (see createEngine); they exist nowhere as importable
// constants, so they are spelled out here.
const SECRET_KEYS = new Set([
  'lastglance-cloud-sync-config', // WebDAV appPassword (file sync engine)
  'lastglance-db-sync-config', // engine-owned twin, normally empty — covered so it can never leak
  'lastglance-vault-config', // GLANCEvault device bearer token
  'lg_intents_config', // WebDAV password, second copy (intents transport)
])

const cache = new Map<string, string>()
let installed = false

// In-flight write-throughs, so a caller that is about to tear the page down
// (SyncSettingsModal reloads after a config change) can wait for the native
// side to actually have the credentials. See flushSecureWrites().
const pending = new Set<Promise<void>>()

function track(p: Promise<void>): void {
  const guarded = p.catch(() => {
    // Native write failed: the cache still serves this session, and the worst
    // case on next boot is the fail-safe — the user re-enters credentials.
  })
  pending.add(guarded)
  void guarded.finally(() => pending.delete(guarded))
}

export function flushSecureWrites(): Promise<void> {
  return Promise.all([...pending]).then(() => undefined)
}

// Original Storage.prototype methods, captured at install time. Hydration uses
// these to reach the real localStorage beneath the shim.
let origGetItem: typeof Storage.prototype.getItem
let origSetItem: typeof Storage.prototype.setItem
let origRemoveItem: typeof Storage.prototype.removeItem

export function installSecureConfigShim(): void {
  if (!isSecureStoreAvailable || installed) return
  installed = true

  const proto = Storage.prototype
  origGetItem = proto.getItem
  origSetItem = proto.setItem
  origRemoveItem = proto.removeItem

  proto.getItem = function (key: string): string | null {
    if (this === window.localStorage && SECRET_KEYS.has(key)) {
      return cache.has(key) ? cache.get(key)! : null
    }
    return origGetItem.call(this, key)
  }

  proto.setItem = function (key: string, value: string): void {
    if (this === window.localStorage && SECRET_KEYS.has(key)) {
      const str = String(value)
      cache.set(key, str)
      track(secureSet(key, str))
      return
    }
    origSetItem.call(this, key, value)
  }

  proto.removeItem = function (key: string): void {
    if (this === window.localStorage && SECRET_KEYS.has(key)) {
      cache.delete(key)
      track(secureDelete(key))
      return
    }
    origRemoveItem.call(this, key)
  }
}

// Boot-time hydration. Must complete before the first render (main.tsx awaits
// it): IntentsContext and the sync engines read these keys synchronously
// during mount, and a miss would present as "sync not configured".
export async function hydrateSecureConfig(): Promise<void> {
  if (!installed) return
  for (const key of SECRET_KEYS) {
    try {
      // Migrate legacy plaintext first. If a plaintext copy exists it is the
      // newest write (pre-shim builds wrote here), so it wins over any secure
      // copy; removal makes the migration one-time.
      const legacy = origGetItem.call(window.localStorage, key)
      if (legacy !== null) {
        await secureSet(key, legacy)
        origRemoveItem.call(window.localStorage, key)
        cache.set(key, legacy)
        continue
      }
      const value = await secureGet(key)
      if (value !== null) cache.set(key, value)
    } catch {
      // SecureStore unavailable for this key — the app degrades to "not
      // configured" for that credential rather than failing to boot.
    }
  }
}

// Test-only: undo the prototype patch and clear module state.
export function uninstallSecureConfigShimForTests(): void {
  if (!installed) return
  Storage.prototype.getItem = origGetItem
  Storage.prototype.setItem = origSetItem
  Storage.prototype.removeItem = origRemoveItem
  cache.clear()
  pending.clear()
  installed = false
}
