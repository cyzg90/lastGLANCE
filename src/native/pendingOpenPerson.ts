// The People counterpart of pendingOpenChore: a People notification tap can
// arrive before People has loaded (cold start), so the request waits here for
// PeopleHome to take it once its data is in.
export type PendingPeopleOpen =
  | { action: 'open' | 'log'; personSyncId: string }
  | { action: 'home' }
  // The add-person form (GLANCElauncher's "Add person"; lastglance://action/addPerson).
  | { action: 'add' }

export const OPEN_PERSON_PENDING_EVENT = 'lg:open-person-pending'

let pending: PendingPeopleOpen | null = null

export function setPendingOpenPerson(request: PendingPeopleOpen): void {
  pending = request
}

export function peekPendingOpenPerson(): PendingPeopleOpen | null {
  return pending
}

export function clearPendingOpenPerson(): void {
  pending = null
}
