import { headlessBridge, type HeadlessBridge } from './headlessMode'

// HTTP for a headless run, over the shell's OkHttp (HeadlessBridge.httpRequestAsync).
// The shell runs each request on a worker thread and answers through
// window.__lgHeadlessHttpDone({ id, result }), result being
// { status, body, headers } or { error }. Two shapes on top: the raw result
// for nativeHttpFetch (WebDAV), and a fetch for the vault client, which the
// app otherwise reaches through CapacitorHttp's patched fetch.

export interface HeadlessHttpResult {
  status: number
  body: string
  headers: Record<string, string>
}

interface Pending {
  resolve: (r: HeadlessHttpResult) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// A reply that never comes (a shell bug, a torn-down page) must not hold the
// run: the worker's own cap is two minutes, so a request may not outlive it.
const RESULT_TIMEOUT_MS = 90_000

let seq = 0
const pending = new Map<string, Pending>()

type DoneMessage = { id?: string; result?: Partial<HeadlessHttpResult> & { error?: string } }

declare global {
  interface Window {
    __lgHeadlessHttpDone?: (msg: DoneMessage) => void
  }
}

function onDone(msg: DoneMessage): void {
  const entry = msg?.id ? pending.get(msg.id) : undefined
  if (!entry || !msg.id) return
  pending.delete(msg.id)
  clearTimeout(entry.timer)
  const r = msg.result
  if (!r || typeof r.status !== 'number') {
    entry.reject(new Error(r?.error || 'no response'))
    return
  }
  entry.resolve({ status: r.status, body: typeof r.body === 'string' ? r.body : '', headers: r.headers ?? {} })
}

export function headlessHttpRequest(
  bridge: HeadlessBridge,
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | null,
): Promise<HeadlessHttpResult> {
  window.__lgHeadlessHttpDone = onDone
  return new Promise((resolve, reject) => {
    const id = `h${++seq}`
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`no response within ${RESULT_TIMEOUT_MS / 1000} s`))
    }, RESULT_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    try {
      bridge.httpRequestAsync(id, method, url, JSON.stringify(headers), body)
    } catch (e) {
      pending.delete(id)
      clearTimeout(timer)
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

// Statuses whose Response may not carry a body. (A final status is never 1xx,
// which the Response constructor would refuse anyway.)
const NULL_BODY = new Set([204, 205, 304])

// A fetch for the vault client (createVaultClient's fetchImpl). String bodies
// only: the vault speaks JSON.
export function headlessFetch(bridge: HeadlessBridge): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value })
    const body = init?.body
    if (body != null && typeof body !== 'string') throw new TypeError('headless fetch: only string bodies')
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const res = await headlessHttpRequest(bridge, method, url, headers, body ?? null)
    return new Response(NULL_BODY.has(res.status) ? null : res.body, { status: res.status, headers: res.headers })
  }
}

// The vault engines' fetchImpl: the shell's HTTP inside a headless run, else
// undefined, which leaves the vault client on the platform fetch (patched by
// CapacitorHttp in the app).
export function headlessFetchImpl(): typeof fetch | undefined {
  const bridge = headlessBridge()
  return bridge ? headlessFetch(bridge) : undefined
}
