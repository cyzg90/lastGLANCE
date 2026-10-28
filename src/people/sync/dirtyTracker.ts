// Bridge between the People data layer (src/people/queries.ts) and the People
// vault engine, mirroring src/sync/dirtyTracker.ts for the chore tables. The
// two are separate on purpose: the People engine syncs the lastglance-people
// vault app with its own dirty set, and a chore engine must never be told
// about a person's sync_id. Managed file pushes run independently of vault.

import type { DbSyncEngine } from '@glance-apps/sync'

const PUSH_DEBOUNCE_MS = 3000

let fileRunner: (() => Promise<unknown>) | null = null
let fileTimer: ReturnType<typeof setTimeout> | null = null

export function registerPeopleFileSyncRunner(runner: (() => Promise<unknown>) | null): void {
  if (fileTimer !== null) clearTimeout(fileTimer)
  fileTimer = null
  fileRunner = runner
}

let peopleDbEngine: DbSyncEngine | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null

function cancelScheduledPush(): void {
  if (pushTimer != null) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
}

function schedulePush(): void {
  if (!peopleDbEngine) return
  cancelScheduledPush()
  pushTimer = setTimeout(() => {
    pushTimer = null
    peopleDbEngine?.dbSyncCycle().catch(() => {/* surfaced via the engine onError */})
  }, PUSH_DEBOUNCE_MS)
}

export function registerPeopleDbEngine(engine: DbSyncEngine | null): void {
  cancelScheduledPush()
  peopleDbEngine = engine
}

// Mark a People entity changed (or deleted: the engine resolves deletions by
// absence, pushing a soft-delete when getLocalEntity returns null).
export function markPeopleDirty(syncId: string | null | undefined): void {
  if (!syncId) return
  if (peopleDbEngine) {
    peopleDbEngine.markDirty(syncId)
    schedulePush()
  }
  if (fileTimer !== null) clearTimeout(fileTimer)
  if (fileRunner) fileTimer = setTimeout(() => {
    fileTimer = null
    fileRunner?.().catch(() => { /* surfaced via onError */ })
  }, 1000)
}
