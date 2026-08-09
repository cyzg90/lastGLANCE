import { describe, it, expect, vi, beforeEach } from 'vitest'

// The platform is read per call (not captured at module load), so a mutable stub
// lets one module instance cover web, Android and iOS. vi.hoisted because
// vi.mock is lifted above ordinary declarations.
const { state, plugin } = vi.hoisted(() => ({
  state: { platform: 'web' },
  plugin: {
    updateSnapshot: vi.fn(async () => {}),
    drainPendingCompletions: vi.fn(async () => ({ completions: '[]' })),
    consumeDeepLink: vi.fn(async () => ({ deepLink: null as string | null })),
    consumeSharedChore: vi.fn(async () => ({ text: null as string | null })),
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => state.platform },
  registerPlugin: () => plugin,
}))

import {
  pushWidgetSnapshot,
  drainPendingCompletions,
  consumeDeepLink,
  consumeSharedChore,
} from './widgetBridge'

beforeEach(() => {
  vi.clearAllMocks()
  state.platform = 'web'
})

describe('widgetBridge platform gating', () => {
  // The point of these two: the guards were Android-only until the iOS shell
  // gained a WidgetBridge plugin. Narrowing them back would silently stop the
  // iOS widgets updating, with no error anywhere (every call swallows).
  it('calls through on ios', async () => {
    state.platform = 'ios'
    await pushWidgetSnapshot('{"version":1}')
    expect(plugin.updateSnapshot).toHaveBeenCalledWith({ json: '{"version":1}' })
  })

  it('calls through on android', async () => {
    state.platform = 'android'
    await pushWidgetSnapshot('{"version":1}')
    expect(plugin.updateSnapshot).toHaveBeenCalledWith({ json: '{"version":1}' })
  })

  it('stays a no-op on web, where no plugin is registered', async () => {
    await pushWidgetSnapshot('{"version":1}')
    expect(plugin.updateSnapshot).not.toHaveBeenCalled()

    expect(await drainPendingCompletions()).toEqual([])
    expect(await consumeDeepLink()).toBeNull()
    expect(await consumeSharedChore()).toBeNull()
    expect(plugin.drainPendingCompletions).not.toHaveBeenCalled()
    expect(plugin.consumeDeepLink).not.toHaveBeenCalled()
    expect(plugin.consumeSharedChore).not.toHaveBeenCalled()
  })
})

describe('widgetBridge result handling', () => {
  beforeEach(() => { state.platform = 'ios' })

  it('parses the completion queue the native side hands back', async () => {
    plugin.drainPendingCompletions.mockResolvedValueOnce({
      completions: '[{"choreSyncId":"a","syncId":"b","completedAt":"2026-07-29T12:00:00Z"}]',
    } as never)
    expect(await drainPendingCompletions()).toEqual([
      { choreSyncId: 'a', syncId: 'b', completedAt: '2026-07-29T12:00:00Z' },
    ])
  })

  it('returns an empty queue rather than throwing on malformed JSON', async () => {
    plugin.drainPendingCompletions.mockResolvedValueOnce({ completions: 'not json' } as never)
    expect(await drainPendingCompletions()).toEqual([])
  })

  it('maps an absent deep link to null', async () => {
    plugin.consumeDeepLink.mockResolvedValueOnce({ deepLink: null } as never)
    expect(await consumeDeepLink()).toBeNull()
  })

  it('passes a deep-link token through verbatim', async () => {
    // Tokens, not URLs: the native side maps lastglance://chore/<id> to this
    // form before storing it, so routeWidgetDeepLink can stay platform-agnostic.
    plugin.consumeDeepLink.mockResolvedValueOnce({ deepLink: 'chore:abc-123' } as never)
    expect(await consumeDeepLink()).toBe('chore:abc-123')
  })

  it('swallows a rejecting plugin call', async () => {
    plugin.updateSnapshot.mockRejectedValueOnce(new Error('app group unavailable') as never)
    await expect(pushWidgetSnapshot('{}')).resolves.toBeUndefined()
  })
})
