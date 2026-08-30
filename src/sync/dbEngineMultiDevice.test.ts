// Multi-device cursor-ordering test for the GLANCEvault DB transport.
//
// Regression guard for the cursor bug fixed in @glance-apps/sync 1.4.0: a PUSH
// must not advance the PULL cursor, otherwise a device that pushes local dirty
// rows in the same cycle it has unread, lower-seq remote rows from a peer would
// skip those remote rows permanently — fatal for insert-only completion events,
// which are never re-written and so never recovered.
//
// lastGLANCE keeps using the engine's default dbSyncCycle (push-then-pull); the
// fix lives in the package (KEY_HWM pull cursor split from KEY_PUSH_ACK). This
// test drives the real engine against an in-memory vault, using lastGLANCE's own
// insert-only / last-modified classifiers, and asserts neither device skips the
// other's rows. It would FAIL on 1.3.2 and MUST PASS on 1.4.0.

import 'fake-indexeddb/auto'
import { webcrypto } from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import { createDbSyncEngine, setupDbRootKey } from '@glance-apps/sync'
import type { VaultClient, PullCursorCommit } from '@glance-apps/sync'
import { isInsertOnly, getEntityLastModified, PULL_CURSOR_COMMIT } from './dbEngine'

// WebCrypto global for the encrypt/decrypt path (Node exposes it; guard anyway).
if (!(globalThis as { crypto?: Crypto }).crypto) {
  ;(globalThis as { crypto?: Crypto }).crypto = webcrypto as unknown as Crypto
}

// Minimal in-memory localStorage. Both engines share it but use distinct
// storageKeyPrefix values, so their cursors / dirty sets stay isolated.
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
installLocalStorage()

// ── In-memory GLANCEvault ────────────────────────────────────────────────────
// One shared, monotonic seq counter across the whole account — the server-side
// invariant the bug hinges on: rows a device pushes now get the HIGHEST seqs, so
// a peer's earlier, unread rows sit at LOWER seqs.
interface VaultRow { seq: number; entityId: string; envelope: string | null; deleted: boolean }

// `pageSize` caps how many rows one list() returns, so a pull paginates the way
// a real backlog does; `hooks.beforeList` observes each page request (and may
// throw, to fail a pull mid-pagination). Both default to the single-page,
// never-failing behaviour the 1.4.0 tests below have always used.
function makeInMemoryVault(opts: { pageSize?: number } = {}) {
  const rows = new Map<string, VaultRow>() // entityId -> latest row
  let seqCounter = 0
  let salt: Uint8Array | null = null
  const hooks: { beforeList: ((since: number) => void) | null } = { beforeList: null }

  return {
    hooks,
    pushed() { return [...rows.values()].sort((a, b) => a.seq - b.seq) },

    async getSalt() { return salt },
    async putSalt(_accountId: string, fresh: Uint8Array) { salt ??= fresh; return salt },

    async batch(_app: string, { rows: incoming }: { accountId: string; rows: { entityId: string; envelope: string }[] }) {
      let maxSeq = seqCounter
      for (const r of incoming) {
        const seq = ++seqCounter
        rows.set(r.entityId, { seq, entityId: r.entityId, envelope: r.envelope, deleted: false })
        maxSeq = seq
      }
      return { maxSeq, written: incoming.length }
    },

    async deleteRow(_app: string, entityId: string) {
      const seq = ++seqCounter
      rows.set(entityId, { seq, entityId, envelope: null, deleted: true })
      return { seq }
    },

    async list(_app: string, { since }: { accountId: string; since: number }) {
      hooks.beforeList?.(since)
      const out = [...rows.values()].filter(r => r.seq > since).sort((a, b) => a.seq - b.seq)
      const page = out.slice(0, opts.pageSize ?? out.length)
      return { rows: page, hasMore: page.length < out.length }
    },

    async device() { return { updated: true } },
  }
}

// ── Per-device local store + lastGLANCE-real adapter callbacks ────────────────
// getLocalEntity / applyRemoteEntity / applyRemoteDelete are per-device (each
// device has its own data), while isInsertOnly / getEntityLastModified are
// lastGLANCE's actual production classifiers.
//
// The cursor mode defaults to lastGLANCE's PRODUCTION declaration, imported
// rather than re-typed, so these tests exercise the mode the app actually ships
// (and an unrecognised value — which the engine refuses at construction — would
// fail every test in this file, not just the cursor ones).
function makeDevice(
  id: string,
  vault: ReturnType<typeof makeInMemoryVault>,
  opts: { pullCursorCommit?: PullCursorCommit } = {},
) {
  const local = new Map<string, Record<string, unknown>>()
  const build = () => createDbSyncEngine({
    storageKeyPrefix: `dev-${id}`,
    appId: 'lastglance',
    vaultApp: 'lastglance',
    cryptoDBName: 'test-crypto',
    accountId: 'acct-1',
    deviceId: id,
    // Intentionally-minimal test double; cast to the full client contract.
    vaultClient: vault as unknown as VaultClient,
    getLocalEntity: async (entityId: string) => local.get(entityId) ?? null,
    applyRemoteEntity: async (entityId: string, entity: unknown) => { local.set(entityId, entity as Record<string, unknown>) },
    applyRemoteDelete: async (entityId: string) => { local.delete(entityId) },
    isInsertOnly,
    getEntityLastModified,
    pullCursorCommit: opts.pullCursorCommit ?? PULL_CURSOR_COMMIT,
  })
  let engine = build()
  // Create a local entity and mark it dirty (mirrors the app's write path).
  const create = (entity: Record<string, unknown>) => {
    local.set(entity.id as string, entity)
    engine.markDirty(entity.id as string)
  }
  return {
    id, local, create,
    get engine() { return engine },
    has: (eid: string) => local.has(eid),
    // Rebuild the engine over the SAME storage prefix and the SAME local store.
    // Models a later cycle / app restart: the persisted cursor survives, the
    // in-memory backoff window a failed primitive opened does not.
    rebuild() { engine = build(); return engine },
  }
}

const cat = (id: string, updatedAt: string) => ({
  id, name: `cat-${id}`, sortOrder: 0, icon: 'Car', parentId: null,
  assignedUserSyncIds: [], updatedAt,
})
const event = (id: string, choreSyncId: string, completedAt: string) => ({
  id, choreSyncId, completedAt, note: null, source: 'manual', completedByUserSyncId: null,
})

beforeAll(async () => {
  // Derive the per-account root key once; both engines share the process-level
  // _rootKey, so each engine's ensureRootKey short-circuits.
  await setupDbRootKey('test-passphrase', new Uint8Array(16).fill(7), { cryptoDBName: 'test-crypto' })
})

describe('GLANCEvault multi-device cursor ordering (1.4.0 fix)', () => {
  it('a push does not advance the pull cursor, so unread lower-seq remote rows are still pulled', async () => {
    const vault = makeInMemoryVault()
    const peer = makeDevice('peer', vault)
    const me = makeDevice('me', vault)

    // Peer publishes a completion event first → lands at the lowest seq (1).
    peer.create(event('e-peer', 'chore-x', '2026-01-01T00:00:00.000Z'))
    await peer.engine.dbSyncCycle()
    expect(vault.pushed()[0].seq).toBe(1)

    // I have a local dirty row AND that unread, lower-seq peer row in one cycle.
    me.create(cat('c-me', '2026-02-02T00:00:00.000Z'))

    // Direct proof of the cursor split: push alone must NOT move the pull cursor.
    await me.engine.pushDirtyRows()
    expect(me.engine.getHighWaterMark()).toBe(0)      // pull cursor untouched by push
    expect(me.engine.getPushAck()).toBeGreaterThan(0) // push-ack advanced instead

    // Pull from the (still 0) cursor → the peer's seq-1 event is listed and applied.
    await me.engine.pullRemoteChanges()
    expect(me.has('e-peer')).toBe(true)
  })

  it('two devices, each with dirty rows + unread peer rows in the same cycle, skip nothing', async () => {
    const vault = makeInMemoryVault()
    const A = makeDevice('A', vault)
    const B = makeDevice('B', vault)

    // B syncs first: its category + completion event land at low seqs (1, 2).
    B.create(cat('cat-B', '2026-03-01T00:00:00.000Z'))
    B.create(event('evt-B', 'chore-B', '2026-03-02T00:00:00.000Z'))
    await B.engine.dbSyncCycle()

    // A now has its own dirty rows AND B's unread, lower-seq rows in one cycle.
    A.create(cat('cat-A', '2026-04-01T00:00:00.000Z'))
    A.create(event('evt-A', 'chore-A', '2026-04-02T00:00:00.000Z'))
    await A.engine.dbSyncCycle() // push A (seq 3,4); pull from cursor 0 → also gets B's 1,2

    // A must have B's rows — especially the insert-only completion event.
    expect(A.has('cat-B')).toBe(true)
    expect(A.has('evt-B')).toBe(true)

    // B gets a fresh dirty row, so B also has dirty rows + unread peer rows (A's
    // seq 3,4) in the same cycle.
    B.create(event('evt-B2', 'chore-B', '2026-05-01T00:00:00.000Z'))
    await B.engine.dbSyncCycle() // push B2 (seq 5,6); pull from cursor 2 → gets A's 3,4

    // B must have A's rows — especially A's insert-only completion event.
    expect(B.has('cat-A')).toBe(true)
    expect(B.has('evt-A')).toBe(true)

    // Sanity: both completion events survived end to end on both devices.
    expect(A.has('evt-A')).toBe(true)
    expect(B.has('evt-B')).toBe(true)
  })
})

// ── Pull-cursor durability contract (@glance-apps/sync 2.0.0) ────────────────
//
// 2.0.0 made the cursor commit point a declared mode and flipped the DEFAULT to
// 'end-of-pull'. lastGLANCE declares 'per-page' (src/sync/dbEngine.ts) to keep
// 1.10.0's mid-pagination resume, which is safe here because applyRemoteEntity
// writes durably into Dexie before it returns. These tests drive the real
// engine over a PAGINATING vault, and each one contrasts the shipped mode
// against the new default — so they fail if the declaration is ever dropped,
// rather than passing under either mode and proving nothing.
describe('pull cursor commit mode (2.0.0 pullCursorCommit)', () => {
  // Publish `n` completion events from a peer so the device under test faces a
  // multi-page backlog. They are insert-only, so a re-listed page is applied
  // again harmlessly — the cost of the wrong mode is bandwidth, not rows.
  async function seedBacklog(prefix: string, vault: ReturnType<typeof makeInMemoryVault>, n: number) {
    const peer = makeDevice(`${prefix}-peer`, vault)
    for (let i = 1; i <= n; i++) {
      peer.create(event(`${prefix}-e${i}`, 'chore-x', `2026-01-01T00:00:0${i}.000Z`))
    }
    await peer.engine.dbSyncCycle()
  }

  it('advances the cursor after each page, which the new default does not', async () => {
    const vault = makeInMemoryVault({ pageSize: 2 })
    await seedBacklog('pp', vault, 6)

    // Sample the PERSISTED cursor at the moment each page is requested. Under
    // 'per-page' it is 0 only for the first page and strictly rises after each
    // completed page; under 'end-of-pull' it stays 0 for the whole loop and
    // moves once, at the end.
    const sample = (dev: ReturnType<typeof makeDevice>, out: number[]) => {
      vault.hooks.beforeList = () => { out.push(dev.engine.getHighWaterMark()) }
    }

    const shipped = makeDevice('pp-shipped', vault) // PULL_CURSOR_COMMIT
    const atPage: number[] = []
    sample(shipped, atPage)
    await shipped.engine.pullRemoteChanges()

    const dflt = makeDevice('pp-default', vault, { pullCursorCommit: 'end-of-pull' })
    const atPageDefault: number[] = []
    sample(dflt, atPageDefault)
    await dflt.engine.pullRemoteChanges()
    vault.hooks.beforeList = null

    // Six rows, two per page: three list() calls, so two commit points are
    // observable mid-loop.
    expect(atPage).toHaveLength(3)
    expect(atPageDefault).toHaveLength(3)

    // The load-bearing assertion. This is what the declaration buys, and it is
    // exactly what fails if lastGLANCE takes the new default.
    expect(atPage[0]).toBe(0)
    expect(atPage[1]).toBeGreaterThan(0)
    expect(atPage[2]).toBeGreaterThan(atPage[1])
    expect(atPageDefault).toEqual([0, 0, 0])

    // Both modes converge: the end state is identical, and unchanged from
    // today. Only the resume point during a failed pull differs.
    const pushed = vault.pushed()
    const finalSeq = pushed[pushed.length - 1].seq
    expect(shipped.engine.getHighWaterMark()).toBe(finalSeq)
    expect(dflt.engine.getHighWaterMark()).toBe(finalSeq)
    for (let i = 1; i <= 6; i++) {
      expect(shipped.has(`pp-e${i}`)).toBe(true)
      expect(dflt.has(`pp-e${i}`)).toBe(true)
    }
  })

  it('resumes a failed pull from the last completed page, where the new default restarts', async () => {
    // Two devices, same six-row backlog, same failure on the third page.
    const run = async (prefix: string, mode: PullCursorCommit | undefined) => {
      const vault = makeInMemoryVault({ pageSize: 2 })
      await seedBacklog(prefix, vault, 6)
      const seqs = vault.pushed().map(r => r.seq)

      const dev = makeDevice(`${prefix}-dev`, vault, mode ? { pullCursorCommit: mode } : {})
      const listedSince: number[] = []
      vault.hooks.beforeList = (since) => {
        listedSince.push(since)
        if (listedSince.length > 2) throw new Error('connection reset')
      }
      await expect(dev.engine.pullRemoteChanges()).rejects.toThrow('connection reset')

      // The resumed pull. It runs on a REBUILT engine because 1.12.0 moved the
      // backoff window down into the primitive: the failure above opened the
      // pull window, so an immediate retry on the same instance is refused with
      // SYNC_SUPPRESSED before any request. The window is per-instance memory;
      // the cursor is what persists, and the cursor is what is under test.
      listedSince.length = 0
      vault.hooks.beforeList = (since) => { listedSince.push(since) }
      await dev.rebuild().pullRemoteChanges()
      vault.hooks.beforeList = null

      return { dev, seqs, resumedFrom: listedSince[0], finalSeq: seqs[seqs.length - 1] }
    }

    // Shipped mode: two pages committed, so the retry resumes at the end of
    // page 2 and never re-downloads rows 1-4.
    const shipped = await run('rz', undefined)
    expect(shipped.dev.engine.getHighWaterMark()).toBeGreaterThan(0)
    expect(shipped.resumedFrom).toBe(shipped.seqs[3])

    // New default: the failed run committed nothing, so the retry re-lists the
    // whole backlog from where the first attempt started. On a flaky connection
    // and a large backlog this never converges — the 1.10.0 bug.
    const dflt = await run('rd', 'end-of-pull')
    expect(dflt.resumedFrom).toBe(0)

    // Both still converge once a pull completes; the difference is the work.
    expect(shipped.dev.engine.getHighWaterMark()).toBe(shipped.finalSeq)
    expect(dflt.dev.engine.getHighWaterMark()).toBe(dflt.finalSeq)
    for (let i = 1; i <= 6; i++) {
      expect(shipped.dev.has(`rz-e${i}`)).toBe(true)
      expect(dflt.dev.has(`rd-e${i}`)).toBe(true)
    }
  })
})
