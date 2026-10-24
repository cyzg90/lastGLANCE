// The headless refresh (docs/launcher-integration.md, "Freshness"): what the
// Android shell runs in an Activity-less WebView, on the launcher's REFRESH,
// while the app's process is dead. One cycle of every sync road the app's own
// REFRESH runs (App.tsx runLauncherSyncCycle: chores and People, file and
// vault), then the launcher snapshot and heartbeat are re-pushed and the
// outcome is reported to the worker.
//
// An ALLOWLIST, not App with features switched off. It loads only the sync
// keys, the four engines and the snapshot builder, all of which read and write
// the app's own IndexedDB and localStorage (the WebView shares the app's
// origin). Nothing else initialises: no UI, reminders, widgets, intents, Direct
// Access or SSE. The native side holds the same line: HeadlessBridge.kt exposes
// only HEADLESS_BRIDGE_METHODS.
//
// The reverse lock: if the user opens the app mid-run, the shell destroys this
// WebView before the live one loads (LauncherRefreshWorker.abortForLiveInstance),
// and the run also asks `headlessShouldAbort` at each phase boundary. Signal
// abort, not wait: the app's own start runs a cycle anyway, and a run makes no
// local edits, so stopping loses nothing.

import { hasDbRootKey, initDbRootKey } from '@glance-apps/sync'
import { createEngine, initSessionKey, CRYPTO_CONFIG, DB_CRYPTO_CONFIG } from '@/sync/engine'
import { createDbEngine } from '@/sync/dbEngine'
import { isVaultEnabled } from '@/sync/vaultConfig'
import { createPeopleFileEngine } from '@/people/sync/fileEngine'
import { createPeopleDbEngine } from '@/people/sync/dbEngine'
import { configureLauncherHeartbeat, latestSyncedAt, pushLauncherSnapshotNow } from '@/hooks/useLauncherSnapshot'
import { HEADLESS_OUTCOMES, type HeadlessBridge, type HeadlessOutcome } from './headlessMode'

// One sync road: its name in the outcome's reason, and one cycle.
export interface HeadlessRoad {
  name: string
  run: () => Promise<unknown>
}

export interface HeadlessRoads {
  roads: HeadlessRoad[]
  // The heartbeat's syncedAt once the roads have run.
  syncedAt: () => string | null
}

// Engines report failures through callbacks rather than by throwing; a road
// reports its latest message (null clears, as each cycle does at its start).
export type ReportError = (road: string, message: string | null) => void

export interface HeadlessDeps {
  bridge: HeadlessBridge
  buildRoads?: (report: ReportError) => Promise<HeadlessRoads>
  pushSnapshot?: () => Promise<void>
  now?: () => number
}

export interface HeadlessResult {
  clientId: string
  outcome: HeadlessOutcome
  reason?: string
  durationMs: number
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

// The four roads, built the way App builds them, with every callback reduced
// to the error report. Keys first: App starts its engines while the keys load,
// which a single cycle cannot afford (an engine that finds no key yet reports a
// passphrase prompt).
export async function buildSyncRoads(report: ReportError): Promise<HeadlessRoads> {
  await initSessionKey(CRYPTO_CONFIG).catch(() => false)
  if (isVaultEnabled() && !hasDbRootKey()) await initDbRootKey(DB_CRYPTO_CONFIG).catch(() => false)

  const proxyUrl = import.meta.env.VITE_WEBDAV_PROXY_URL
  const file = createEngine(proxyUrl, {
    onStatusChange: () => {},
    onError: (msg) => report('file', msg),
    onLastSyncedChange: () => {},
    onPassphraseRequired: () => report('file', 'passphrase required'),
  })
  const vault = createDbEngine({
    onError: (msg, code) => report('vault', code === 'PASSPHRASE_REQUIRED' ? 'passphrase required' : msg),
  })
  const peopleFile = createPeopleFileEngine(proxyUrl, file, { onError: (msg) => report('people file', msg) })
  const peopleVault = createPeopleDbEngine({ onError: (msg) => report('people vault', msg) })

  const roads: HeadlessRoad[] = [{ name: 'file', run: () => file.sync() }]
  if (vault) roads.push({ name: 'vault', run: () => vault.dbSyncCycle() })
  roads.push({ name: 'people file', run: () => peopleFile.sync() })
  if (peopleVault) roads.push({ name: 'people vault', run: () => peopleVault.dbSyncCycle() })
  return {
    roads,
    syncedAt: () => latestSyncedAt([file.getLastSynced?.(), vault?.getLastSynced?.()]),
  }
}

// One run: roads, snapshot, outcome. Reports through `headlessDone` and
// resolves with the same record; never throws.
export async function runHeadlessRefresh(clientId: string, deps: HeadlessDeps): Promise<HeadlessResult> {
  const { bridge, buildRoads = buildSyncRoads, pushSnapshot = pushLauncherSnapshotNow, now = Date.now } = deps
  const started = now()
  const errors = new Map<string, string | null>()
  const report: ReportError = (road, message) => { errors.set(road, message || null) }

  const done = (outcome: HeadlessOutcome, reason?: string): HeadlessResult => {
    const result: HeadlessResult = { clientId, outcome, durationMs: now() - started, ...(reason ? { reason } : {}) }
    try { bridge.headlessDone(JSON.stringify(result)) } catch { /* the worker decides on its cap */ }
    return result
  }
  const shouldAbort = () => { try { return bridge.headlessShouldAbort() } catch { return false } }

  try {
    if (shouldAbort()) return done(HEADLESS_OUTCOMES.ABORTED, 'app opened')
    const { roads, syncedAt } = await buildRoads(report)
    if (shouldAbort()) return done(HEADLESS_OUTCOMES.ABORTED, 'app opened')
    await Promise.all(roads.map(road => road.run().catch((e: unknown) => report(road.name, messageOf(e)))))
    if (shouldAbort()) return done(HEADLESS_OUTCOMES.ABORTED, 'app opened')
    // Pushed whatever the roads did: one that failed may sit beside one that
    // applied, and the heartbeat's checkedAt records the look either way.
    configureLauncherHeartbeat(syncedAt)
    await pushSnapshot()
    const failed = [...errors].filter((entry): entry is [string, string] => !!entry[1])
    if (failed.length) return done(HEADLESS_OUTCOMES.FAILED, failed.map(([road, msg]) => `${road}: ${msg}`).join('; '))
    return done(HEADLESS_OUTCOMES.RAN)
  } catch (e) {
    return done(HEADLESS_OUTCOMES.FAILED, messageOf(e))
  }
}
