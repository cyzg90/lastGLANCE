import { afterEach, describe, expect, it, vi } from 'vitest'
import { appPath } from './appPath'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('appPath', () => {
  it('builds URLs relative to a relative Vite base', () => {
    vi.stubEnv('BASE_URL', './')
    expect(appPath('/api/internal-webdav')).toBe('./api/internal-webdav')
  })

  it('normalizes a base without a trailing slash', () => {
    vi.stubEnv('BASE_URL', '/lastglance')
    expect(appPath('locales/en/translation.json')).toBe('/lastglance/locales/en/translation.json')
  })
})
