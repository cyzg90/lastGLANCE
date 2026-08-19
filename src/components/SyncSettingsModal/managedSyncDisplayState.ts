import type { SyncStatus } from '@glance-apps/sync'

export type ManagedSyncDisplayState = 'halted' | 'error' | 'syncing' | 'connected' | 'idle'

export function getManagedSyncDisplayState(
  syncStatus: SyncStatus,
  hasError: boolean,
  halted: boolean,
): ManagedSyncDisplayState {
  if (halted) return 'halted'
  if (hasError || syncStatus === 'error') return 'error'
  if (syncStatus === 'uploading' || syncStatus === 'downloading') return 'syncing'
  if (syncStatus === 'success') return 'connected'
  return 'idle'
}
