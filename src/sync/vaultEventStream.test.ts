// Tests for the SSE push client core, against the REAL wire format (verified
// from the glance-vault server source and observed live): named events
// `event: ready` / `event: activity` whose data is exactly {"seq":N}, plus
// comment-line heartbeats. No test fabricates fields the server does not send.

import { describe, it, expect, vi } from 'vitest'
import {
  parseSseFrame,
  drainSseBuffer,
  createBridgeSseClient,
  createNudgeCoalescer,
  createVaultEventClient,
  openWebSseStream,
  SseUnsupportedError,
  type SseClientState,
} from './vaultEventStream'

// Real frames, byte-shaped as the server sends them.
const READY = 'event: ready\ndata: {"seq":3}'
const ACTIVITY = (seq: number) => `event: activity\ndata: {"seq":${seq}}`

describe('parseSseFrame', () => {
  it('parses a ready frame to its {seq} nudge (event name not surfaced)', () => {
    expect(parseSseFrame(READY)).toEqual({ seq: 3 })
  })

  it('parses an activity frame identically', () => {
    expect(parseSseFrame(ACTIVITY(7))).toEqual({ seq: 7 })
  })

  it('returns null for a heartbeat-only block', () => {
    expect(parseSseFrame(': heartbeat')).toBeNull()
  })

  it('tolerates CRLF line endings', () => {
    expect(parseSseFrame('event: activity\r\ndata: {"seq":9}\r')).toEqual({ seq: 9 })
  })

  it('concatenates multiple data lines per the SSE spec', () => {
    expect(parseSseFrame('data: {"seq"\ndata: :12}')).toEqual({ seq: 12 })
  })

  it('returns null on unparseable data and on event-name-only blocks', () => {
    expect(parseSseFrame('data: not-json')).toBeNull()
    expect(parseSseFrame('event: ready')).toBeNull()
  })
})

describe('drainSseBuffer', () => {
  it('emits each complete event and returns the unconsumed remainder', () => {
    const seen: unknown[] = []
    const rest = drainSseBuffer(`${READY}\n\n${ACTIVITY(5)}\n\n${ACTIVITY(6)}`, e => seen.push(e))
    expect(seen).toEqual([{ seq: 3 }, { seq: 5 }])
    expect(rest).toBe(ACTIVITY(6)) // incomplete: no blank-line delimiter yet
  })

  it('reassembles frames split across chunk boundaries', () => {
    const seen: unknown[] = []
    let buf = ''
    for (const chunk of ['event: acti', 'vity\nda', 'ta: {"seq":42}\n', '\n: heartbeat\n\n']) {
      buf = drainSseBuffer(buf + chunk, e => seen.push(e))
    }
    expect(seen).toEqual([{ seq: 42 }])
    expect(buf).toBe('')
  })
})

// Timer harness: captures scheduled callbacks so tests fire them explicitly.
function makeTimers() {
  let nextId = 1
  const pending = new Map<number, () => void>()
  return {
    setTimeoutFn: ((cb: () => void) => { const id = nextId++; pending.set(id, cb); return id }) as unknown as typeof setTimeout,
    clearTimeoutFn: ((id: number) => { pending.delete(id) }) as unknown as typeof clearTimeout,
    fire: () => { const cbs = [...pending.values()]; pending.clear(); cbs.forEach(cb => cb()) },
    pendingCount: () => pending.size,
  }
}

describe('createNudgeCoalescer', () => {
  it('accepts advancing seqs, ignores stale and duplicate ones', () => {
    const timers = makeTimers()
    const c = createNudgeCoalescer({ onDrain: () => {}, ...timers })
    expect(c.handleEvent({ seq: 3 })).toBe(true)   // ready
    expect(c.handleEvent({ seq: 3 })).toBe(false)  // duplicate
    expect(c.handleEvent({ seq: 2 })).toBe(false)  // stale
    expect(c.handleEvent({ seq: 7 })).toBe(true)   // advanced
    expect(c.handleEvent(null)).toBe(false)
    expect(c.handleEvent({ seq: NaN })).toBe(false)
    expect(c.getCursor()).toBe(7)
  })

  it('coalesces a burst into ONE flush that drains sync then intents', () => {
    const timers = makeTimers()
    const drains: string[] = []
    const c = createNudgeCoalescer({ onDrain: k => drains.push(k), ...timers })
    c.handleEvent({ seq: 1 })
    c.handleEvent({ seq: 2 })
    c.handleEvent({ seq: 3 })
    expect(drains).toEqual([]) // debounced, nothing yet
    timers.fire()
    expect(drains).toEqual(['sync', 'intents'])
  })

  it('a throwing sync drain does not prevent the intents drain', () => {
    const timers = makeTimers()
    const drains: string[] = []
    const errors: string[] = []
    const c = createNudgeCoalescer({
      onDrain: k => { drains.push(k); if (k === 'sync') throw new Error('boom') },
      onDrainError: msg => errors.push(msg),
      ...timers,
    })
    c.handleEvent({ seq: 1 })
    timers.fire()
    expect(drains).toEqual(['sync', 'intents'])
    expect(errors).toEqual(['vault-sse drain (sync) failed'])
  })

  it('cancel() drops a pending flush', () => {
    const timers = makeTimers()
    const drains: string[] = []
    const c = createNudgeCoalescer({ onDrain: k => drains.push(k), ...timers })
    c.handleEvent({ seq: 1 })
    c.cancel()
    timers.fire()
    expect(drains).toEqual([])
  })
})

describe('createVaultEventClient', () => {
  const connection = { vaultUrl: 'http://v', vaultToken: 't', accountId: 'a' }

  // Runs the client loop against a scripted openStream. Reconnect delays are
  // captured; timers fire on a microtask so the loop advances without real
  // waiting. random=0.5 makes the ±25% jitter factor exactly 1.0.
  function run(openStream: (args: { onOpen?: () => void }) => Promise<void>, opts: {
    nowSteps?: number[]
    random?: () => number
  } = {}) {
    const delays: number[] = []
    const states: SseClientState[] = []
    let nowIdx = 0
    const nowSteps = opts.nowSteps
    const client = createVaultEventClient({
      getConnection: () => connection,
      openStream: openStream as unknown as typeof openWebSseStream,
      onEvent: () => {},
      now: nowSteps ? () => nowSteps[Math.min(nowIdx++, nowSteps.length - 1)] : () => 0,
      random: opts.random ?? (() => 0.5),
      setTimeoutFn: ((cb: () => void, ms: number) => {
        delays.push(ms)
        queueMicrotask(cb)
        return 0
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: (() => {}) as unknown as typeof clearTimeout,
      onStateChange: s => states.push(s),
    })
    return { client, delays, states }
  }

  it('backs off exponentially with the jitter factor applied, capped at max', async () => {
    let calls = 0
    const { client, delays } = run(async () => {
      calls++
      if (calls >= 8) client.stop()
      throw new Error('connect refused')
    })
    client.start()
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(8))
    // random=0.5 → factor 1.0 → raw ladder: 1s 2s 4s 8s 16s 30s(cap) 30s ...
    expect(delays.slice(0, 7)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })

  it('jitter spreads the delay within ±25%', async () => {
    let calls = 0
    const { client, delays } = run(async () => {
      calls++
      if (calls >= 2) client.stop()
      throw new Error('nope')
    }, { random: () => 0 }) // low edge
    client.start()
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(2))
    expect(delays[0]).toBe(750) // 1000 * 0.75
  })

  it('resets the backoff only after a connection proves stable', async () => {
    let calls = 0
    const { client, delays } = run(
      async () => {
        calls++
        if (calls >= 4) client.stop()
        throw new Error('drop')
      },
      // now() is read twice per connection (startedAt, then the stability
      // check). Connections 1-2 last 0ms (unstable → ladder climbs); the THIRD
      // lasts 6s (≥ minStableMs 5s) → attempt resets, so its delay drops back
      // to the base instead of continuing to 4s.
      { nowSteps: [0, 0, 0, 0, 1000, 7000, 7000, 7000] },
    )
    client.start()
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(4))
    expect(delays.slice(0, 3)).toEqual([1000, 2000, 1000])
  })

  it('treats a 404 (SseUnsupportedError) as terminal: stops, never retries', async () => {
    let calls = 0
    const { client, states, delays } = run(async () => {
      calls++
      throw new SseUnsupportedError()
    })
    client.start()
    await vi.waitFor(() => expect(states).toContain('unsupported-server'))
    expect(calls).toBe(1)
    expect(delays).toEqual([]) // no reconnect was ever scheduled
    expect(client.isRunning()).toBe(false)
  })

  it('reports stalled when a stream opens but no frame arrives in time', async () => {
    const { client, states } = run(async ({ onOpen }: { onOpen?: () => void }) => {
      onOpen?.()
      // Never emits an event, never resolves promptly: the ready timer (also on
      // the microtask timer harness) fires first.
      await new Promise<void>(resolve => { setTimeout(resolve, 5) })
      client.stop()
    })
    client.start()
    await vi.waitFor(() => expect(states).toContain('stalled'))
  })
})

describe('createBridgeSseClient', () => {
  const connection = { vaultUrl: 'http://v', vaultToken: 't', accountId: 'a' }

  function make(getConnection: () => typeof connection | null = () => connection) {
    const started: unknown[] = []
    let stops = 0
    const events: unknown[] = []
    const states: Array<[SseClientState, unknown?]> = []
    const client = createBridgeSseClient({
      getConnection,
      startNative: c => started.push(c),
      stopNative: () => { stops++ },
      onEvent: e => events.push(e),
      onStateChange: (s, d) => states.push([s, d]),
    })
    return { client, started, events, states, stops: () => stops }
  }

  it('start hands the connection to native; stop tears down; both idempotent', () => {
    const { client, started, stops } = make()
    expect(client.start()).toBe(true)
    expect(client.start()).toBe(false) // already running
    expect(started).toEqual([connection])
    client.stop()
    client.stop()
    expect(stops()).toBe(1)
    expect(client.isRunning()).toBe(false)
  })

  it('does not start without a connection (polling covers)', () => {
    const { client, started } = make(() => null)
    expect(client.start()).toBe(false)
    expect(started).toEqual([])
  })

  it('routes frames through the shared parser and forwards only real nudges', () => {
    const { client, events } = make()
    client.receive({ type: 'frame', block: 'event: ready\ndata: {"seq":3}' })
    client.receive({ type: 'frame', block: 'event: activity\ndata: {"seq":7}' })
    client.receive({ type: 'frame', block: ': heartbeat' })    // parses to null → dropped
    client.receive({ type: 'frame', block: 'data: not-json' }) // unparseable → dropped
    expect(events).toEqual([{ seq: 3 }, { seq: 7 }])
  })

  it('accepts JSON-string messages from a stringifying shell', () => {
    const { client, events, states } = make()
    client.receive('{"type":"open"}')
    client.receive('{"type":"frame","block":"event: activity\\ndata: {\\"seq\\":9}"}')
    expect(states).toEqual([['open', undefined]])
    expect(events).toEqual([{ seq: 9 }])
  })

  it('surfaces coded (terminal) errors with the code attached, plain errors without', () => {
    const { client, states } = make()
    client.receive({ type: 'error', message: 'auth failed: 401', code: 'auth' })
    client.receive({ type: 'error', message: 'read reset' })
    expect(states).toEqual([
      ['error', { message: 'auth failed: 401', code: 'auth' }],
      ['error', 'read reset'],
    ])
  })

  it('ignores malformed pushes without throwing', () => {
    const { client, events, states } = make()
    client.receive(null)
    client.receive(42)
    client.receive('not json')
    client.receive({ type: 'mystery' })
    client.receive({ type: 'frame' }) // no block
    expect(events).toEqual([])
    expect(states).toEqual([])
  })
})

describe('openWebSseStream', () => {
  const connection = { vaultUrl: 'http://vault.test/', vaultToken: 'tok', accountId: 'acct-1' }

  function sseResponse(chunks: string[]): Response {
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c))
        controller.close()
      },
    })
    return { ok: true, status: 200, body } as unknown as Response
  }

  it('requests /events with Bearer auth, no credentials, and pumps real frames', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const seen: unknown[] = []
    await openWebSseStream({
      connection,
      onEvent: e => seen.push(e),
      fetchImpl: (async (url: string, init: RequestInit) => {
        captured = { url, init }
        return sseResponse([`${READY}\n\n`, ': heartbeat\n\n', `${ACTIVITY(4)}\n\n`])
      }) as unknown as typeof fetch,
    })
    expect(captured!.url).toBe('http://vault.test/events?accountId=acct-1')
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(captured!.init.credentials).toBe('omit')
    expect(seen).toEqual([{ seq: 3 }, { seq: 4 }])
  })

  it('classifies a 404 as SseUnsupportedError (server predates /events)', async () => {
    await expect(openWebSseStream({
      connection,
      onEvent: () => {},
      fetchImpl: (async () => ({ ok: false, status: 404, body: null })) as unknown as typeof fetch,
    })).rejects.toBeInstanceOf(SseUnsupportedError)
  })

  it('throws a plain retryable error on any other failure status', async () => {
    await expect(openWebSseStream({
      connection,
      onEvent: () => {},
      fetchImpl: (async () => ({ ok: false, status: 429, body: null })) as unknown as typeof fetch,
    })).rejects.toThrow('vault SSE connect failed: 429')
  })
})
