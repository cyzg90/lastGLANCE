const DB_NAME = 'lastglance-intents-crypto'
const STORE_NAME = 'keys'
const ROOT_KEY_ID = 'root-key'
// The Direct Access intents key, stored WITH the base64 salt it was derived
// from: the folder's event set names the salt, and a file that changes salt
// needs a new key (intents/directAccessIntentsKey.ts).
const DIRECT_ACCESS_ROOT_KEY_ID = 'direct-access-root-key'

export interface DirectAccessKeyRecord { saltB64: string; key: CryptoKey }

let _cachedRootKey: CryptoKey | null = null
let _cachedDirectAccessRecord: DirectAccessKeyRecord | null = null

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function storeIntentsRootKey(key: CryptoKey): Promise<void> {
  _cachedRootKey = key
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(key, ROOT_KEY_ID)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function loadIntentsRootKey(): Promise<CryptoKey | null> {
  if (_cachedRootKey !== null) return _cachedRootKey
  let db: IDBDatabase
  try {
    db = await openDB()
  } catch {
    return null
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(ROOT_KEY_ID)
    req.onsuccess = () => {
      const key = (req.result as CryptoKey | undefined) ?? null
      _cachedRootKey = key
      resolve(key)
    }
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function clearIntentsRootKey(): Promise<void> {
  _cachedRootKey = null
  let db: IDBDatabase
  try {
    db = await openDB()
  } catch {
    return
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).delete(ROOT_KEY_ID)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function storeDirectAccessIntentsKey(record: DirectAccessKeyRecord): Promise<void> {
  _cachedDirectAccessRecord = record
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(record, DIRECT_ACCESS_ROOT_KEY_ID)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function loadDirectAccessIntentsKey(): Promise<DirectAccessKeyRecord | null> {
  if (_cachedDirectAccessRecord !== null) return _cachedDirectAccessRecord
  let db: IDBDatabase
  try {
    db = await openDB()
  } catch {
    return null
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(DIRECT_ACCESS_ROOT_KEY_ID)
    req.onsuccess = () => {
      const r = req.result as Partial<DirectAccessKeyRecord> | undefined
      const record = r && typeof r.saltB64 === 'string' && r.key ? (r as DirectAccessKeyRecord) : null
      _cachedDirectAccessRecord = record
      resolve(record)
    }
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function clearDirectAccessIntentsKey(): Promise<void> {
  _cachedDirectAccessRecord = null
  let db: IDBDatabase
  try {
    db = await openDB()
  } catch {
    return
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).delete(DIRECT_ACCESS_ROOT_KEY_ID)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}
