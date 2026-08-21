import { afterEach, describe, expect, it, vi } from 'vitest'
import { managedWebdavEndpoint } from './managedWebdav'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('managedWebdavEndpoint', () => {
  it.each([
    ['https://internal.lastglance.invalid/GLANCE/', '/api/internal-webdav/glance-directory'],
    ['https://internal.lastglance.invalid/GLANCE/lastglance/', '/api/internal-webdav/sync-directory'],
    ['https://internal.lastglance.invalid/GLANCE/lastglance/lastglance-sync.json', '/api/internal-webdav/sync'],
    ['https://internal.lastglance.invalid/GLANCE/lastglance/backups/', '/api/internal-webdav/backups-directory'],
    ['https://internal.lastglance.invalid/GLANCE/users/', '/api/internal-webdav/users-directory'],
    ['https://internal.lastglance.invalid/GLANCE/users/glance-users.json', '/api/internal-webdav/users'],
  ])('maps %s to a fixed proxy resource', (target, expected) => {
    expect(managedWebdavEndpoint(target)).toBe(expected)
  })

  it('maps a valid backup filename', () => {
    expect(managedWebdavEndpoint(
      'https://internal.lastglance.invalid/GLANCE/lastglance/backups/lastglance-backup-2026-08-14T15-30-00.json',
    )).toBe('/api/internal-webdav/backups/lastglance-backup-2026-08-14T15-30-00.json')
  })

  it('preserves an explicitly configured proxy URL', () => {
    vi.stubEnv('VITE_WEBDAV_PROXY_URL', 'https://proxy.example.com')
    expect(managedWebdavEndpoint(
      'https://internal.lastglance.invalid/GLANCE/lastglance/lastglance-sync.json',
    )).toBe('https://proxy.example.com/sync')
  })

  it.each([
    'https://example.com/GLANCE/lastglance/lastglance-sync.json',
    'https://internal.lastglance.invalid/GLANCE/other/file.json',
    'https://internal.lastglance.invalid/GLANCE/lastglance/%2525252e%2525252e/secret',
    'https://internal.lastglance.invalid/GLANCE/lastglance/backups/other.json',
    'https://internal.lastglance.invalid/GLANCE/lastglance/lastglance-sync.json?url=http://example.com',
  ])('rejects an unsupported target: %s', target => {
    expect(() => managedWebdavEndpoint(target)).toThrow()
  })
})
