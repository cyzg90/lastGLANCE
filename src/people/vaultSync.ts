// Household privacy: People normally sync on the shared vault like chores do.
// Turning this off keeps them off the vault, so they travel only through the
// user's own file sync.
export const PEOPLE_VAULT_SYNC_KEY = 'lg-people-vault-sync'

export function isPeopleVaultSyncEnabled(): boolean {
  try { return localStorage.getItem(PEOPLE_VAULT_SYNC_KEY) !== 'false' } catch { return true }
}
