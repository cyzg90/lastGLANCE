import type { ContactAction } from '@/native/contacts'

// After Call, Text or Email hands off to another app, coming back offers a
// one-tap log (ReturnToLogPrompt). Held in memory only: if the app is killed
// while away, the offer is simply lost.
export interface PendingReturn { personSyncId: string; name: string; action: ContactAction; at: number }

let pending: PendingReturn | null = null
// Coming back hours later is not "just made the call".
const STALE_MS = 2 * 60 * 60 * 1000

export function expectReturnFrom(p: Omit<PendingReturn, 'at'>, now = Date.now()): void {
  pending = { ...p, at: now }
}

// The pending offer, once, if it is still fresh.
export function takeReturn(now = Date.now()): PendingReturn | null {
  const p = pending
  pending = null
  return p && now - p.at < STALE_MS ? p : null
}
