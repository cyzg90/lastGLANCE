import { describe, it, expect, beforeEach } from 'vitest'
import { getVaultConfig, setVaultConfig, isVaultEnabled } from './vaultConfig'

function installLocalStorage(): void {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  } as Storage
}

describe('vaultConfig', () => {
  beforeEach(() => { installLocalStorage() })

  it('returns null when nothing is stored', () => {
    expect(getVaultConfig()).toBeNull()
    expect(isVaultEnabled()).toBe(false)
  })

  it('saves and loads a full config round-trip', () => {
    const cfg = {
      enabled: true,
      vaultUrl: 'https://vault.glance-apps.com',
      vaultToken: 'tok_abc123',
      accountId: 'household-42',
    }
    setVaultConfig(cfg)
    expect(getVaultConfig()).toEqual(cfg)
    expect(isVaultEnabled()).toBe(true)
  })

  it('clears the config when passed null', () => {
    setVaultConfig({ enabled: true, vaultUrl: 'u', vaultToken: 't', accountId: 'a' })
    setVaultConfig(null)
    expect(getVaultConfig()).toBeNull()
    expect(isVaultEnabled()).toBe(false)
  })

  it('treats a disabled or incomplete config as not enabled', () => {
    setVaultConfig({ enabled: false, vaultUrl: 'u', vaultToken: 't', accountId: 'a' })
    expect(isVaultEnabled()).toBe(false)

    setVaultConfig({ enabled: true, vaultUrl: '', vaultToken: 't', accountId: 'a' })
    expect(isVaultEnabled()).toBe(false)
  })

  it('tolerates malformed stored JSON', () => {
    localStorage.setItem('lastglance-vault-config', '{not valid json')
    expect(getVaultConfig()).toBeNull()
  })
})

describe('clearCredentialHalt (#257)', () => {
  it('removes exactly the credential-halt key, nothing else', async () => {
    const { clearCredentialHalt } = await import('./vaultConfig')
    localStorage.setItem('lastglance-db-sync-credential-halt', '{"message":"rejected"}')
    localStorage.setItem('lastglance-db-sync-hwm', '42')
    clearCredentialHalt()
    expect(localStorage.getItem('lastglance-db-sync-credential-halt')).toBeNull()
    expect(localStorage.getItem('lastglance-db-sync-hwm')).toBe('42')
  })
})

describe('resetVaultSyncState + vaultIdentityChanged (re-link reset)', () => {
  it('clears the seed flag and every engine cursor; preserves device-scoped keys', async () => {
    const { resetVaultSyncState } = await import('./vaultConfig')
    const streamKeys = [
      'lastglance-db-sync-snapshot-seeded', 'lastglance-db-sync-config',
      'lastglance-db-sync-hwm', 'lastglance-db-sync-push-ack',
      'lastglance-db-sync-dirty', 'lastglance-db-sync-quarantine',
      'lastglance-db-sync-last-synced', 'lastglance-db-sync-credential-halt',
    ]
    for (const k of streamKeys) localStorage.setItem(k, 'x')
    localStorage.setItem('lastglance-device-id', 'dev-keep')
    localStorage.setItem('lastglance-db-sync-hwm-recovery-gen', '2')
    resetVaultSyncState()
    for (const k of streamKeys) expect(localStorage.getItem(k)).toBeNull()
    expect(localStorage.getItem('lastglance-device-id')).toBe('dev-keep')
    expect(localStorage.getItem('lastglance-db-sync-hwm-recovery-gen')).toBe('2')
  })

  it('identity comparison: account/server changes count, token rotation does not', async () => {
    const { vaultIdentityChanged } = await import('./vaultConfig')
    const base = { vaultUrl: 'https://vault.example', accountId: 'house-1' }
    expect(vaultIdentityChanged(base, { ...base })).toBe(false)
    expect(vaultIdentityChanged(base, { ...base, vaultUrl: 'https://vault.example ' })).toBe(false) // trim
    expect(vaultIdentityChanged(base, { vaultUrl: 'https://other.example', accountId: 'house-1' })).toBe(true)
    expect(vaultIdentityChanged(base, { vaultUrl: 'https://vault.example', accountId: 'house-2' })).toBe(true)
    expect(vaultIdentityChanged(null, base)).toBe(false)  // fresh link: unlink reset covers it
    expect(vaultIdentityChanged(base, null)).toBe(false)  // unlink handled separately
  })
})
