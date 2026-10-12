import { deriveIntentsRootKey } from '@glance-apps/intents'
import type { IntentsConfig } from './config'
import { buildAuthHeader, ensureFolder, putFile, getFileOrNull } from './webdav'
import { storeIntentsRootKey } from './intentsKeyStore'

const SALT_FILENAME = 'intents-encryption-salt.json'

async function fetchOrCreateSharedSalt(config: IntentsConfig, authHeader: string): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await getFileOrNull(config.webdavUrl, config.folderPath, SALT_FILENAME, authHeader)

  if (raw !== null) {
    const parsed = JSON.parse(raw) as { salt: string }
    const bytes = Uint8Array.from(atob(parsed.salt), c => c.charCodeAt(0))
    return new Uint8Array(bytes.buffer as ArrayBuffer)
  }

  const buf = new ArrayBuffer(16)
  const salt = crypto.getRandomValues(new Uint8Array(buf))
  const b64 = btoa(String.fromCharCode(...salt))
  const body = JSON.stringify({ version: 1, salt: b64, created_at: new Date().toISOString() })
  await putFile(config.webdavUrl, config.folderPath, SALT_FILENAME, body, authHeader)
  return new Uint8Array(buf)
}

/**
 * The WebDAV salt as stored, base64, or null when there is none or WebDAV
 * cannot be reached. Never creates one: a device that also runs WebDAV intents
 * seeds the folder's event set with THIS salt, so the key it already holds is
 * the key the folder uses (intents/directAccessIntentsKey.ts).
 */
export async function fetchSharedSaltB64(config: IntentsConfig): Promise<string | null> {
  try {
    const raw = await getFileOrNull(config.webdavUrl, config.folderPath, SALT_FILENAME, buildAuthHeader(config.webdavUsername, config.webdavPassword))
    if (raw === null) return null
    const parsed = JSON.parse(raw) as { salt?: unknown }
    return typeof parsed.salt === 'string' && parsed.salt ? parsed.salt : null
  } catch {
    return null
  }
}

export async function setupIntentsEncryption(config: IntentsConfig, passphrase: string): Promise<void> {
  const authHeader = buildAuthHeader(config.webdavUsername, config.webdavPassword)
  await ensureFolder(config.webdavUrl, config.folderPath, authHeader)
  const salt = await fetchOrCreateSharedSalt(config, authHeader)
  const rootKey = await deriveIntentsRootKey(passphrase, salt)
  await storeIntentsRootKey(rootKey)
}
