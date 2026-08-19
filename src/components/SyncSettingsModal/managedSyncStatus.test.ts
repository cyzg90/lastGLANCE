import { describe, expect, it } from 'vitest'
import { getManagedSyncDisplayState } from './managedSyncDisplayState'

describe('getManagedSyncDisplayState', () => {
  it.each([
    ['idle', false, false, 'idle'],
    ['success', false, false, 'connected'],
    ['uploading', false, false, 'syncing'],
    ['downloading', false, false, 'syncing'],
    ['error', false, false, 'error'],
  ] as const)('maps %s to %s', (status, hasError, halted, expected) => {
    expect(getManagedSyncDisplayState(status, hasError, halted)).toBe(expected)
  })

  it('gives errors priority over an active sync status', () => {
    expect(getManagedSyncDisplayState('uploading', true, false)).toBe('error')
  })

  it('gives a hard stop priority over errors', () => {
    expect(getManagedSyncDisplayState('error', true, true)).toBe('halted')
  })
})
