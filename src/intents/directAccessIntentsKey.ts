// The Direct Access intents key (docs/direct-access.md, step 3).
//
// Encrypted envelopes in the folder's event set are sealed under per-envelope
// keys derived from one root key, and every device on the folder has to
// derive the same root key: the sync passphrase they share, and one salt. The
// WebDAV intents transport keeps its salt in a file on the server, which a
// folder-only device (a phone with no WebDAV at all) can never reach, and an
// iPhone holds a bookmark to the event set alone and could not read a second
// file beside it. So the salt travels IN the event set:
//
//   glance-events.json = { version: 1, writtenBy?, salt?: base64, events }
//
// The file's salt, once there, is the salt: the merge keeps it and no device
// replaces it. A sender that wants to encrypt and finds no salt in the file
// brings one, in this order: the salt it already seeded (kept locally, so a
// file the syncing tool loses is reseeded with the same one), the WebDAV salt
// when this device also runs WebDAV intents (so the key it already holds is
// the folder's key), else a fresh random one. The derived key is cached with
// its salt; a file naming a different salt means a new key, derived again
// from the passphrase when it is in memory and asked for once when it is not.
// dayGLANCE's src/intents/directAccessIntentsKey.js is the same rule.

import { deriveIntentsRootKey } from '@glance-apps/intents'
import { getSyncPassphrase } from '@glance-apps/sync'
import { loadDirectAccessIntentsKey, storeDirectAccessIntentsKey, type DirectAccessKeyRecord } from './intentsKeyStore'
import { parseEventSetText, relativeEventsPath, type EventSetTransport } from './eventSet'

/** base64 of the 16 salt bytes this device brought to the event set, kept so a lost file is reseeded with the same one. */
export const DIRECT_ACCESS_INTENTS_SALT_KEY = 'lg_direct_access_intents_salt'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
const defaultStorage = (): StorageLike => (typeof localStorage === 'undefined' ? null : localStorage)

export function readOwnSalt(storage: StorageLike = defaultStorage()): string | null {
  try { const v = storage?.getItem(DIRECT_ACCESS_INTENTS_SALT_KEY); return typeof v === 'string' && v ? v : null } catch { return null }
}
export function writeOwnSalt(saltB64: string | null, storage: StorageLike = defaultStorage()): void {
  try {
    if (saltB64) storage?.setItem(DIRECT_ACCESS_INTENTS_SALT_KEY, saltB64)
    else storage?.removeItem(DIRECT_ACCESS_INTENTS_SALT_KEY)
  } catch { /* ignore */ }
}

export const newSaltB64 = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}
export const saltBytes = (b64: string): Uint8Array<ArrayBuffer> => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new Uint8Array(bytes.buffer as ArrayBuffer)
}

/** Pure: the salt a sender uses. The file's wins; then what this device brought before; then WebDAV's; then a new one. */
export function chooseSalt({ fileSalt, ownSalt, webdavSalt, random = newSaltB64 }: { fileSalt: string | null; ownSalt: string | null; webdavSalt: string | null; random?: () => string }): string {
  return fileSalt || ownSalt || webdavSalt || random()
}

export interface KeyDeps {
  passphrase?: string | null
  loadCached?: () => Promise<DirectAccessKeyRecord | null>
  storeCached?: (record: DirectAccessKeyRecord) => Promise<void>
}

/** The root key for a salt: the cached one when it was derived from this salt, else derived from the passphrase and cached, else null. */
export async function keyForSalt(saltB64: string | null, deps: KeyDeps = {}): Promise<CryptoKey | null> {
  if (!saltB64) return null
  const loadCached = deps.loadCached ?? loadDirectAccessIntentsKey
  const storeCached = deps.storeCached ?? storeDirectAccessIntentsKey
  const passphrase = deps.passphrase === undefined ? getSyncPassphrase() : deps.passphrase
  let cached: DirectAccessKeyRecord | null = null
  try { cached = await loadCached() } catch { cached = null }
  if (cached && cached.saltB64 === saltB64 && cached.key) return cached.key
  if (!passphrase) return null
  const key = await deriveIntentsRootKey(passphrase, saltBytes(saltB64))
  try { await storeCached({ saltB64, key }) } catch { /* the key still serves this session */ }
  return key
}

/** The salt the event set names, or null: absent file, no salt yet, or a file that cannot be read now. */
export async function readFileSalt(transport: EventSetTransport, eventsPath?: string | null): Promise<string | null> {
  try {
    const read = parseEventSetText(await transport.events.read(relativeEventsPath(eventsPath)))
    return read.kind === 'set' ? read.salt : null
  } catch {
    return null
  }
}

export interface ResolveDeps extends KeyDeps {
  transport: EventSetTransport
  eventsPath?: string | null
  storage?: StorageLike
  /** The WebDAV salt, asked for only when neither the file nor this device has one. */
  webdavSalt?: () => Promise<string | null>
  random?: () => string
}

/**
 * What a sender needs to seal: the salt the file names (or the one this
 * device brings) and the key for it. `key` is null when no passphrase is in
 * memory and no cached key matches: hold, and ask for the passphrase.
 */
export async function resolveDirectAccessIntentsKey(deps: ResolveDeps): Promise<{ salt: string; key: CryptoKey | null }> {
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage
  const fileSalt = await readFileSalt(deps.transport, deps.eventsPath)
  const ownSalt = readOwnSalt(storage)
  const webdavSalt = fileSalt || ownSalt ? null : await (deps.webdavSalt ?? (async () => null))()
  const salt = chooseSalt({ fileSalt, ownSalt, webdavSalt, ...(deps.random ? { random: deps.random } : {}) })
  if (salt !== ownSalt) writeOwnSalt(salt, storage)
  const key = await keyForSalt(salt, deps)
  return { salt, key }
}

// ── Enable-time orchestration, the shape of ensureVaultIntentsKey ────────────

export interface EnsureDirectAccessKeyDeps {
  resolve: (passphrase?: string | null) => Promise<{ salt: string; key: CryptoKey | null }>
  promptForPassphrase: () => Promise<string | null>
}
export type EnsureDirectAccessKeyResult = { status: 'ready' } | { status: 'cancelled' } | { status: 'error'; error: unknown }

/** Ready with the key for the folder's salt, from the cache or the passphrase in memory, else from one prompt; never enables without a key. */
export async function ensureDirectAccessIntentsKey(deps: EnsureDirectAccessKeyDeps): Promise<EnsureDirectAccessKeyResult> {
  try {
    if ((await deps.resolve()).key) return { status: 'ready' }
    const passphrase = await deps.promptForPassphrase()
    if (!passphrase) return { status: 'cancelled' }
    return (await deps.resolve(passphrase)).key ? { status: 'ready' } : { status: 'error', error: new Error('no key') }
  } catch (error) {
    return { status: 'error', error }
  }
}
