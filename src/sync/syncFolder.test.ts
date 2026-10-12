import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SYNC_FOLDER, SYNC_FOLDER_KEY, getSyncFolder, normalizeSyncFolder } from './syncFolder'

describe('normalizeSyncFolder', () => {
  it('strips the leading slash that produced //webdav/... URLs', () => {
    expect(normalizeSyncFolder('/webdav/GLANCE/lastglance')).toBe('webdav/GLANCE/lastglance')
  })

  it('strips trailing and repeated slashes, backslashes and "." segments', () => {
    expect(normalizeSyncFolder('GLANCE/lastglance/')).toBe('GLANCE/lastglance')
    expect(normalizeSyncFolder('GLANCE//lastglance')).toBe('GLANCE/lastglance')
    expect(normalizeSyncFolder('  /GLANCE/ lastglance /  ')).toBe('GLANCE/lastglance')
    expect(normalizeSyncFolder('GLANCE\\lastglance')).toBe('GLANCE/lastglance')
    expect(normalizeSyncFolder('./GLANCE/./lastglance')).toBe('GLANCE/lastglance')
  })

  it('leaves a clean folder untouched', () => {
    expect(normalizeSyncFolder('GLANCE/lastglance')).toBe('GLANCE/lastglance')
    expect(normalizeSyncFolder('lastglance')).toBe('lastglance')
  })

  it('falls back when nothing usable is left', () => {
    expect(normalizeSyncFolder('/')).toBe(DEFAULT_SYNC_FOLDER)
    expect(normalizeSyncFolder('')).toBe(DEFAULT_SYNC_FOLDER)
    expect(normalizeSyncFolder(null)).toBe(DEFAULT_SYNC_FOLDER)
  })
})

describe('getSyncFolder', () => {
  const store = new Map<string, string>()
  const original = globalThis.localStorage
  beforeEach(() => {
    store.clear()
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => store.clear(),
      key: () => null,
      get length() { return store.size },
    } as Storage
  })
  afterEach(() => { globalThis.localStorage = original })

  it('normalizes a folder stored before the fix', () => {
    store.set(SYNC_FOLDER_KEY, '/webdav/GLANCE/lastglance/')
    expect(getSyncFolder()).toBe('webdav/GLANCE/lastglance')
  })

  it('defaults when nothing is stored', () => {
    expect(getSyncFolder()).toBe(DEFAULT_SYNC_FOLDER)
  })
})
