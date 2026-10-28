import { createPeopleFileEngine } from '@/people/sync/fileEngine'
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEngine } from './engine'
import { configureManagedWebdav } from './managedWebdav'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('managed engine after a sync library upgrade', () => {
  it('ignores the old folder and routes requests through the subpath proxy', async () => {
    const store = new Map<string, string>([
      ['lastglance-cloud-sync-folder', '/old//folder/'],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
    })
    vi.stubEnv('VITE_WEBDAV_PROXY_URL', '/lastglance/api/internal-webdav')
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    // App constructs the engine before replacing the saved managed config.
    const engine = createEngine(undefined, {
      onStatusChange: () => {},
      onError: () => {},
      onLastSyncedChange: () => {},
      onPassphraseRequired: () => {},
    })
    configureManagedWebdav(engine)
    await expect(engine.providers.webdav.download(engine.getConfig()!)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/lastglance/api/internal-webdav/sync', {
      method: 'GET', headers: {},
    })
    const people = createPeopleFileEngine(undefined, engine)
    people.setConfig(engine.getConfig())
    await expect(people.providers.webdav.download(people.getConfig()!)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenLastCalledWith('/lastglance/api/internal-webdav/people', {
      method: 'GET', headers: {},
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
