import { afterEach, describe, expect, it, vi } from 'vitest'

// The vault engines reach GLANCEvault through the platform fetch, which
// CapacitorHttp patches in the app. A headless run has no CapacitorHttp, so
// both engines (chores and People) must hand the vault client the shell's
// HTTP, and the app must keep the platform fetch.

const captured: Record<string, unknown>[] = []
vi.mock('@glance-apps/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@glance-apps/sync')>()
  return {
    ...actual,
    createDbSyncEngine: (config: Record<string, unknown>) => {
      captured.push(config)
      return { dbSyncCycle: async () => ({}), markDirty: () => {}, getHighWaterMark: () => 1, getLastSynced: () => null }
    },
  }
})

class FakeStorage {
  private store = new Map<string, string>()
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null }
  setItem(k: string, v: string): void { this.store.set(k, String(v)) }
  removeItem(k: string): void { this.store.delete(k) }
  clear(): void { this.store.clear() }
  key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null }
  get length(): number { return this.store.size }
}

async function engines(search: string, bridge: unknown) {
  const g = globalThis as Record<string, unknown>
  g.window = globalThis
  g.localStorage = new FakeStorage()
  g.location = { search }
  g.LastGlanceHeadless = bridge
  localStorage.setItem('lastglance-vault-config', JSON.stringify({
    enabled: true, vaultUrl: 'https://vault.example', vaultToken: 't', accountId: 'acct',
  }))
  captured.length = 0
  vi.resetModules()
  const { createDbEngine } = await import('@/sync/dbEngine')
  const { createPeopleDbEngine } = await import('@/people/sync/dbEngine')
  createDbEngine()
  createPeopleDbEngine()
  return captured.map(c => c.fetchImpl as typeof fetch | undefined)
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>
  delete g.LastGlanceHeadless
  delete g.__lgHeadlessHttpDone
})

describe('the vault engines in a headless run', () => {
  it('both send their requests through the shell', async () => {
    const urls: string[] = []
    const bridge = {
      httpRequestAsync: (id: string, _m: string, url: string) => {
        urls.push(url)
        setTimeout(() => (globalThis as { __lgHeadlessHttpDone?: (m: unknown) => void }).__lgHeadlessHttpDone?.({
          id, result: { status: 200, body: '{}', headers: {} },
        }), 0)
      },
    }
    const fetches = await engines('?headless=refresh&clientId=rf', bridge)
    expect(fetches).toHaveLength(2)
    for (const f of fetches) await f!('https://vault.example/healthz')
    expect(urls).toEqual(['https://vault.example/healthz', 'https://vault.example/healthz'])
  })

  it('the app keeps the platform fetch', async () => {
    const fetches = await engines('', { httpRequestAsync: vi.fn() })
    expect(fetches).toEqual([undefined, undefined])
  })
})
