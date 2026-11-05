// The sync cycle behind the launcher's REFRESH, with a time limit.
//
// A live REFRESH runs every configured tier at once (App.tsx). A tier that
// never returns (a request that hangs) used to leave the request silent until
// the native keep-awake hold gave up and marked it `unanswered`, with nothing
// to say which tier it was. Now the whole cycle fails after REFRESH_CAP_MS,
// under the 60 s hold, naming the tiers still running; launcherWrites records
// that as `failed`. The tiers themselves are not cancelled.

/** How long a whole REFRESH may take before it fails with the tiers still running. */
export const REFRESH_CAP_MS = 45_000

/** One sync tier: a label for the failure message, and the work. */
export type RefreshTier = readonly [label: string, run: () => Promise<unknown>]

/**
 * Runs every tier at once; resolves when all have, rejects with the first
 * tier's error, or after [capMs] with `timed out after N s waiting on <tiers>`.
 */
export async function runCappedRefreshCycle(tiers: readonly RefreshTier[], capMs: number = REFRESH_CAP_MS): Promise<void> {
  const pending = new Set<string>()
  const jobs = tiers.map(([label, run]) => {
    pending.add(label)
    return run().finally(() => pending.delete(label))
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const cap = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${Math.round(capMs / 1000)} s waiting on ${[...pending].join(', ') || 'the cycle'}`)),
      capMs,
    )
  })
  try {
    await Promise.race([Promise.all(jobs), cap])
  } finally {
    clearTimeout(timer)
  }
}
