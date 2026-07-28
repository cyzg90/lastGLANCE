import { isSecureStoreAvailable, secureDelete, secureGet, secureSet } from '@/native/secureStore'

// SecureStore-backed implementations of the `nativeGetSyncKey` /
// `nativeStoreSyncKey` hooks that `@glance-apps/sync` ships for exactly this
// purpose (issue #210) and that the app has so far passed as null. With the
// hooks present the package stops using its `lastglance-crypto*` IndexedDB
// databases — the two records it kept there are extractable raw key bytes
// (`rawKey` for the file-sync key, `rootBytes` for the vault HKDF root), the
// most sensitive artifacts in WebView storage.
//
// The package treats the hooks as either/or with IndexedDB (no fallback), so
// each getter carries its own one-time legacy migration: read the old record,
// re-encode it as the exact base64 blob the package's native path expects,
// store it in the SecureStore, then delete the IndexedDB copy (leaving it
// would defeat the point — the bytes are extractable where they sit).
//
// Two separately-bound hook pairs are required. The file tier and the DB tier
// use the SAME hook names in the package (`initSessionKey` vs `initDbRootKey`
// both call `nativeGetSyncKey`), so a single shared pair would make both
// tiers read and clobber one SecureStore entry. FILE_SYNC_KEY_HOOKS binds to
// 'crypto.sync-key', DB_ROOT_KEY_HOOKS to 'crypto.db-root-key'.
//
// On non-Android platforms both exports are empty objects: spread into a
// config they contribute nothing, the package sees no hooks, and IndexedDB
// behavior is unchanged.

interface NativeKeyHooks {
  nativeGetSyncKey?: () => Promise<string | null>
  nativeStoreSyncKey?: (b64: string | null) => void
}

// Read one record from a legacy crypto DB without creating stores. Opening
// versionless never triggers an upgrade, so a missing store just reads null.
function readLegacyRecord(dbName: string, storeName: string, id: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(dbName)
      req.onerror = () => resolve(null)
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(storeName)) {
          db.close()
          resolve(null)
          return
        }
        const get = db.transaction(storeName, 'readonly').objectStore(storeName).get(id)
        get.onerror = () => { db.close(); resolve(null) }
        get.onsuccess = () => { db.close(); resolve(get.result ?? null) }
      }
    } catch {
      resolve(null)
    }
  })
}

function deleteLegacyRecord(dbName: string, storeName: string, id: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(dbName)
      req.onerror = () => resolve()
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(storeName)) {
          db.close()
          resolve()
          return
        }
        const tx = db.transaction(storeName, 'readwrite')
        tx.objectStore(storeName).delete(id)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); resolve() }
      }
    } catch {
      resolve()
    }
  })
}

// number[] | ArrayBuffer | TypedArray → plain number[] for the JSON blob.
function toByteArray(v: unknown): number[] {
  if (Array.isArray(v)) return v
  if (v instanceof ArrayBuffer) return Array.from(new Uint8Array(v))
  if (ArrayBuffer.isView(v)) return Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
  return []
}

function makeHooks(
  storeKey: string,
  legacy: { dbName: string; storeName: string; id: string },
  // Re-encode the legacy IndexedDB record into the package's native blob shape.
  // Returns null when the record is malformed — treated as absent.
  recordToBlob: (record: Record<string, unknown>) => Record<string, unknown> | null,
): NativeKeyHooks {
  if (!isSecureStoreAvailable) return {}
  return {
    nativeGetSyncKey: async () => {
      const existing = await secureGet(storeKey)
      if (existing !== null) return existing
      const record = await readLegacyRecord(legacy.dbName, legacy.storeName, legacy.id)
      if (!record) return null
      const blob = recordToBlob(record)
      if (!blob) return null
      const b64 = btoa(JSON.stringify(blob))
      await secureSet(storeKey, b64)
      await deleteLegacyRecord(legacy.dbName, legacy.storeName, legacy.id)
      return b64
    },
    nativeStoreSyncKey: (b64: string | null) => {
      // The package calls this fire-and-forget (null means "clear").
      void (b64 === null ? secureDelete(storeKey) : secureSet(storeKey, b64)).catch(() => {
        // Failed persist: the in-memory session key still works; next boot
        // falls back to the passphrase prompt (fail-safe).
      })
    },
  }
}

// File-tier sync key: record { rawKey: ArrayBuffer, salt: number[] } in
// lastglance-crypto/keys, blob shape { rawKey: number[], salt: number[] }.
export const FILE_SYNC_KEY_HOOKS: NativeKeyHooks = makeHooks(
  'crypto.sync-key',
  { dbName: 'lastglance-crypto', storeName: 'keys', id: 'sync-key' },
  (record) => {
    const rawKey = toByteArray(record.rawKey)
    const salt = toByteArray(record.salt)
    return rawKey.length && salt.length ? { rawKey, salt } : null
  },
)

// Vault root key: record { rootBytes: number[], salt: number[] } in
// lastglance-crypto-db/db-root-keys, blob shape { rootBytes, salt }.
export const DB_ROOT_KEY_HOOKS: NativeKeyHooks = makeHooks(
  'crypto.db-root-key',
  { dbName: 'lastglance-crypto-db', storeName: 'db-root-keys', id: 'db-root-key' },
  (record) => {
    const rootBytes = toByteArray(record.rootBytes)
    const salt = toByteArray(record.salt)
    return rootBytes.length && salt.length ? { rootBytes, salt } : null
  },
)
