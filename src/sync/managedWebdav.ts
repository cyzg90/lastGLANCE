import type { SyncEngine } from '@glance-apps/sync'
import { registerFileSyncRunner } from './fileSyncScheduler'

export const MANAGED_WEBDAV = true
export const MANAGED_WEBDAV_URL = 'https://internal.lastglance.invalid'
export const MANAGED_WEBDAV_USERNAME = 'managed'
export const MANAGED_WEBDAV_PASSWORD = 'managed'
export const MANAGED_SYNC_FOLDER = 'GLANCE/lastglance'
export const MANAGED_WEBDAV_PROXY_URL = '/api/internal-webdav'

const MANAGED_ORIGIN = new URL(MANAGED_WEBDAV_URL).origin
const BACKUP_FILENAME_RE = /^lastglance-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/

const WELCOME_KEY = 'lg-welcome-dismissed'
const SYNC_FOLDER_KEY = 'lastglance-cloud-sync-folder'

export function configureManagedWebdav(engine: SyncEngine): void {
  localStorage.setItem(SYNC_FOLDER_KEY, MANAGED_SYNC_FOLDER)
  engine.setConfig({
    provider: 'webdav',
    webdavUrl: MANAGED_WEBDAV_URL,
    username: MANAGED_WEBDAV_USERNAME,
    appPassword: MANAGED_WEBDAV_PASSWORD,
    syncFolder: MANAGED_SYNC_FOLDER,
    enabled: true,
    encryptionEnabled: false,
  })
}

export async function bootstrapManagedWebdav(engine: SyncEngine): Promise<void> {
  configureManagedWebdav(engine)
  registerFileSyncRunner(() => engine.sync())
  localStorage.setItem(WELCOME_KEY, '1')
}

export function managedWebdavEndpoint(targetUrl: string): string {
  const target = new URL(targetUrl)
  if (target.origin !== MANAGED_ORIGIN || target.username || target.password || target.search || target.hash) {
    throw new Error('Unsupported managed WebDAV target')
  }

  const pathname = target.pathname.replace(/\/$/, '')
  let resource: string
  switch (pathname) {
    case '/GLANCE': resource = 'glance-directory'; break
    case '/GLANCE/lastglance': resource = 'sync-directory'; break
    case '/GLANCE/lastglance/lastglance-sync.json': resource = 'sync'; break
    case '/GLANCE/lastglance/backups': resource = 'backups-directory'; break
    case '/GLANCE/users': resource = 'users-directory'; break
    case '/GLANCE/users/glance-users.json': resource = 'users'; break
    default: {
      const prefix = '/GLANCE/lastglance/backups/'
      if (!target.pathname.startsWith(prefix)) throw new Error('Unsupported managed WebDAV target')
      const encodedFilename = target.pathname.slice(prefix.length)
      let filename: string
      try {
        filename = decodeURIComponent(encodedFilename)
      } catch {
        throw new Error('Invalid managed WebDAV backup filename')
      }
      if (!BACKUP_FILENAME_RE.test(filename)) throw new Error('Invalid managed WebDAV backup filename')
      resource = `backups/${encodeURIComponent(filename)}`
    }
  }

  const proxyUrl = import.meta.env.VITE_WEBDAV_PROXY_URL || MANAGED_WEBDAV_PROXY_URL
  return `${proxyUrl.replace(/\/$/, '')}/${resource}`
}

export async function managedWebdavFetch(
  method: string,
  targetUrl: string,
  headers: Record<string, string>,
  body: string | null,
): Promise<{ status: number; ok: boolean; statusText: string; body: string; headers: { etag?: string } }> {
  const forwardedHeaders: Record<string, string> = {}
  for (const name of ['Content-Type', 'Depth', 'If-Match', 'If-None-Match']) {
    if (headers[name] !== undefined) forwardedHeaders[name] = headers[name]
  }
  const response = await fetch(managedWebdavEndpoint(targetUrl), {
    method,
    headers: forwardedHeaders,
    ...(body !== null ? { body } : {}),
  })
  return {
    status: response.status,
    ok: response.ok,
    statusText: response.statusText,
    body: await response.text(),
    headers: { etag: response.headers.get('etag') ?? undefined },
  }
}
