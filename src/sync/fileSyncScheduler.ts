const FILE_SYNC_DEBOUNCE_MS = 1000

type FileSyncRunner = () => Promise<unknown>

let fileSyncRunner: FileSyncRunner | null = null
let fileSyncTimer: ReturnType<typeof setTimeout> | null = null

function cancelScheduledFileSync(): void {
  if (fileSyncTimer != null) {
    clearTimeout(fileSyncTimer)
    fileSyncTimer = null
  }
}

// The managed WebDAV bootstrap owns the active file engine. Registering a new
// runner replaces the previous one and drops any pending work for the old one.
export function registerFileSyncRunner(runner: FileSyncRunner | null): void {
  cancelScheduledFileSync()
  fileSyncRunner = runner
}

// Coalesce entity-level dirty marks from one logical edit (sorting, cascading
// deletes, restores) into one full-payload WebDAV cycle.
export function scheduleFileSync(): void {
  if (!fileSyncRunner) return
  cancelScheduledFileSync()
  fileSyncTimer = setTimeout(() => {
    fileSyncTimer = null
    const run = fileSyncRunner
    if (!run) return
    try {
      run().catch(() => { /* surfaced through the sync engine's onError */ })
    } catch {
      // Keep data writes independent from a synchronously failing runner.
    }
  }, FILE_SYNC_DEBOUNCE_MS)
}
