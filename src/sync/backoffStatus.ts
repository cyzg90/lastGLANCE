import type { DbSyncEngine, SyncErrorCode } from '@glance-apps/sync'
import type { TFunction } from 'i18next'

// Standing-backoff display state for the Cloud Sync modal (issue #250).
//
// The sync 1.10 engine treats onError as an EVENT STREAM, not a status store:
// a cycle that runs fires its onError(null) reset even when a backoff window
// suppresses one half, so storing the last message as standing status goes
// blank while sync genuinely is not working. The engine added
// getBackoffState() for exactly this — render the standing window from it
// instead. This module is the pure half (injected clock, unit-tested) so the
// pattern lifts straight into lifeGLANCE when its backoff UI lands.
//
// Scope rules:
//   - 'transport' and 'auth' windows are described here.
//   - 'quota' windows are EXCLUDED: the engine re-surfaces QUOTA_EXCEEDED
//     (with its descriptor) on every cycle, so quota already has a standing
//     display; a second banner would double-report.
//   - The credential halt never opens a window and has its own display.
//   - A lapsed-but-uncleared window (until in the past; the engine clears it
//     only when a cycle SUCCEEDS) reports secondsLeft 0 — "retrying on the
//     next sync" — rather than vanishing, because sync is still unproven.

type BackoffWindowLike = {
  until: number
  reason: 'quota' | 'auth' | 'transport' | null
  code: SyncErrorCode | string | null
}

export interface BackoffDescriptor {
  reason: 'transport' | 'auth'
  side: 'push' | 'pull'
  until: number
  /** Whole seconds until the next automatic retry; 0 once the window lapsed. */
  secondsLeft: number
}

export function describeBackoff(
  state: { push: BackoffWindowLike; pull: BackoffWindowLike } | null | undefined,
  nowMs: number,
): BackoffDescriptor | null {
  if (!state) return null
  const all: Array<{ side: 'push' | 'pull'; w: BackoffWindowLike }> = [
    { side: 'push', w: state.push },
    { side: 'pull', w: state.pull },
  ]
  const candidates = all.filter(({ w }) => w && w.until > 0 && (w.reason === 'transport' || w.reason === 'auth'))
  if (candidates.length === 0) return null
  // With both windows open, the later `until` is the binding constraint (and an
  // auth window's flat hour naturally outranks a transport ladder, surfacing
  // the more actionable message).
  const { side, w } = candidates.reduce((a, b) => (b.w.until > a.w.until ? b : a))
  return {
    reason: w.reason as 'transport' | 'auth',
    side,
    until: w.until,
    secondsLeft: Math.max(0, Math.ceil((w.until - nowMs) / 1000)),
  }
}

// The user-facing line for a standing window. Kept beside describeBackoff so
// the modal renders exactly one vocabulary:
//   transport, counting down -> sync.backoff.transport ("Retrying in {{seconds}}s.")
//   auth                     -> sync.backoff.auth (flat hour; no countdown — a
//                               ticking 3600s would imply precision the flat
//                               window doesn't have)
//   lapsed (secondsLeft 0)   -> sync.backoff.retrying
export function backoffStatusText(t: TFunction, d: BackoffDescriptor | null): string | null {
  if (!d) return null
  if (d.secondsLeft === 0) return t('sync.backoff.retrying')
  if (d.reason === 'auth') return t('sync.backoff.auth')
  return t('sync.backoff.transport', { seconds: d.secondsLeft })
}

/** Convenience for call sites holding the engine: null when vault sync is off. */
export function currentBackoff(engine: DbSyncEngine | null | undefined, nowMs = Date.now()): BackoffDescriptor | null {
  if (!engine?.getBackoffState) return null
  return describeBackoff(engine.getBackoffState(), nowMs)
}
