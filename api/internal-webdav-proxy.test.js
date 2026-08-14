import { describe, expect, it } from 'vitest'
import { resolveManagedTarget } from './internal-webdav-proxy.js'

const BASE = 'http://webdav:6065'

describe('resolveManagedTarget', () => {
  it.each([
    ['/glance-directory', 'http://webdav:6065/GLANCE/'],
    ['/sync-directory', 'http://webdav:6065/GLANCE/lastglance/'],
    ['/sync', 'http://webdav:6065/GLANCE/lastglance/lastglance-sync.json'],
    ['/backups-directory', 'http://webdav:6065/GLANCE/lastglance/backups/'],
    ['/users-directory', 'http://webdav:6065/GLANCE/users/'],
    ['/users', 'http://webdav:6065/GLANCE/users/glance-users.json'],
  ])('maps the fixed resource %s', (resource, expected) => {
    expect(resolveManagedTarget(resource, BASE).target.href).toBe(expected)
  })

  it('allows only the managed backup filename format', () => {
    const result = resolveManagedTarget(
      '/backups/lastglance-backup-2026-08-14T15-30-00.json',
      BASE,
    )
    expect(result.target.href).toBe(
      'http://webdav:6065/GLANCE/lastglance/backups/lastglance-backup-2026-08-14T15-30-00.json',
    )
    expect(result.methods.has('DELETE')).toBe(true)
  })

  it('does not grant destructive methods to directory resources', () => {
    const result = resolveManagedTarget('/sync-directory', BASE)
    expect(result.methods.has('PROPFIND')).toBe(true)
    expect(result.methods.has('MKCOL')).toBe(true)
    expect(result.methods.has('PUT')).toBe(false)
    expect(result.methods.has('DELETE')).toBe(false)
  })

  it.each([
    '',
    '/',
    '/GLANCE/lastglance/lastglance-sync.json',
    '/sync/anything',
    '/backups/other.json',
    '/backups/../secret.json',
    '/backups/%2525252e%2525252e%2525252fsecret.json',
    '/backups/lastglance-backup-2026-08-14T15-30-00.json/extra',
  ])('rejects an unknown or unsafe resource: %s', resource => {
    expect(() => resolveManagedTarget(resource, BASE)).toThrow()
  })

  it('preserves a server-controlled internal base path', () => {
    expect(resolveManagedTarget('/sync', 'http://webdav:6065/dav').target.href).toBe(
      'http://webdav:6065/dav/GLANCE/lastglance/lastglance-sync.json',
    )
  })

  it.each([
    'ftp://webdav/root',
    'http://user:password@webdav:6065',
    'not a url',
  ])('rejects an unsafe server-side root URL: %s', base => {
    expect(() => resolveManagedTarget('/sync', base)).toThrow()
  })
})
