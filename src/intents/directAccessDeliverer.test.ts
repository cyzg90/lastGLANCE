import { describe, it, expect, vi } from 'vitest'
import { createDirectAccessDeliverer, type DirectAccessDelivererDeps } from './deliverers'
import { INTENTS_KEY_NOT_READY } from './outbox'
import type { OutboxIntent } from './outbox'
import type { EventSetTransport, RawEnvelope } from './eventSet'

const intent: OutboxIntent = {
  event_id: '20261011T120000Z-abcdef',
  action: 'create',
  emitted_by: 'app.lastglance',
  emitted_at: '2026-10-11T12:00:00.000Z',
  payload: { title: 'Water plants', due: '2026-10-11', all_day: true, source_app: 'app.lastglance', source_entity_id: 'chore-1' },
}
const transport = { id: 'da', isAvailable: () => true, events: { supported: () => true, read: async () => null, write: async () => true } } as EventSetTransport & { isAvailable: () => boolean }

describe('the Direct Access deliverer', () => {
  it('holds while the opt-in is off or the folder is away, never giving up', async () => {
    const publish = vi.fn(async () => true)
    const off = createDirectAccessDeliverer({ transport, isEnabled: () => false, encrypts: () => false, resolveKey: async () => ({ salt: 'c2FsdA==', key: null }), publish })
    expect(await off(intent)).toBe('transient-fail')
    const away = createDirectAccessDeliverer({ transport: { ...transport, isAvailable: () => false }, isEnabled: () => true, encrypts: () => false, resolveKey: async () => ({ salt: 'c2FsdA==', key: null }), publish })
    expect(await away(intent)).toBe('transient-fail')
    expect(publish).not.toHaveBeenCalled()
  })

  it('publishes a plaintext envelope with the intent\'s own id, and reports delivered once the file holds it', async () => {
    const published: RawEnvelope[] = []
    const publish = vi.fn<DirectAccessDelivererDeps['publish']>(async (_t, e) => { published.push(e); return true })
    const d = createDirectAccessDeliverer({ transport, isEnabled: () => true, encrypts: () => false, resolveKey: async () => ({ salt: 'c2FsdA==', key: null }), publish })
    expect(await d(intent)).toBe('delivered')
    expect(published[0]).toMatchObject({ event_id: intent.event_id, emitted_by: 'app.lastglance', action: 'create' })
    expect(published[0].encrypted).toBeUndefined()
    publish.mockResolvedValueOnce(false)
    expect(await d(intent)).toBe('transient-fail')
  })

  it('with the encrypt switch on it holds without a key for the file\'s salt, and seals with one', async () => {
    const published: RawEnvelope[] = []
    const publish = vi.fn<DirectAccessDelivererDeps['publish']>(async (_t, e) => { published.push(e); return true })
    const noKey = createDirectAccessDeliverer({ transport, isEnabled: () => true, encrypts: () => true, resolveKey: async () => ({ salt: 'c2FsdA==', key: null }), publish })
    expect(await noKey(intent)).toEqual({ status: 'transient-fail', reason: INTENTS_KEY_NOT_READY })
    expect(publish).not.toHaveBeenCalled()
    const { deriveIntentsRootKey } = await import('@glance-apps/intents')
    const root = await deriveIntentsRootKey('pass', new Uint8Array(16).fill(7))
    const sealed = createDirectAccessDeliverer({ transport, isEnabled: () => true, encrypts: () => true, resolveKey: async () => ({ salt: 'c2FsdA==', key: root }), publish })
    expect(await sealed(intent)).toBe('delivered')
    expect(published[0]).toMatchObject({ event_id: intent.event_id, encrypted: true })
    // The salt rides along to the file.
    expect(publish.mock.calls[0][2]).toMatchObject({ salt: 'c2FsdA==' })
  })
})
