// The sync folder is joined into every WebDAV URL by @glance-apps/sync as
// `${base}/${folder}/${file}` without normalizing it, so a folder typed as
// "/webdav/GLANCE/lastglance" sent sync requests to
// "https://host//webdav/GLANCE/lastglance/lastglance-sync.json". Meanwhile
// ensureFolder stripped one leading slash and created the folder at the single-
// slash path, so the folder existed and sync still 404'd on servers that don't
// resolve the doubled slash (reported against dayGLANCE, krelltunez/dayGLANCE#2037).

export const DEFAULT_SYNC_FOLDER = 'GLANCE/lastglance'
export const SYNC_FOLDER_KEY = 'lastglance-cloud-sync-folder'

/**
 * Strip leading/trailing slashes and empty or "." segments from a sync folder.
 * Backslashes count as separators, for paths pasted from Windows. Falls back to
 * the default when nothing is left.
 */
export function normalizeSyncFolder(raw: unknown, fallback: string = DEFAULT_SYNC_FOLDER): string {
  if (typeof raw !== 'string') return fallback
  const parts = raw.split(/[/\\]+/).map(p => p.trim()).filter(p => p && p !== '.')
  return parts.length ? parts.join('/') : fallback
}

/**
 * The stored sync folder, normalized. Normalizing on read as well as on save
 * fixes a folder stored before this change without the user re-entering it.
 */
export function getSyncFolder(): string {
  return normalizeSyncFolder(localStorage.getItem(SYNC_FOLDER_KEY))
}
