// The People file through Direct Access: lastglance-people.json beside the
// chore file in the same folder (Android) or as its own bookmarked file (iOS),
// run through the shared cycle (src/sync/directAccessCycle.ts) with People's
// seams. A second file rather than a `people` array in the chore snapshot for
// the reason the WebDAV tier has one (fileEngine.ts): an older build merges
// the chore file from the arrays it knows and would write People away.
//
// What is People's here:
//   • the payload, merge and apply are the People WebDAV engine's, so the two
//     tiers agree on every row;
//   • people, interactions, dates and circles count as data;
//   • "made here" is People's own edit stamp (markPeopleDirty), so a chore
//     edit never makes this device write the People file at once;
//   • an apply stamps the People WebDAV engine's local-modified key, so a
//     change that arrived through the folder is pushed on by WebDAV too.
// The folder, the switch, the encrypt choice and the key are the chore file's.

import type { SnapshotFileOutcome, SnapshotFileState } from '@glance-apps/sync'
import { runDirectAccessCycle, type DirectAccessCycleDeps } from '@/sync/directAccessCycle'
import { lastPeopleLocalEditAt } from '@/sync/localEditStamp'
import { applyPeoplePayload, buildPeoplePayload, mergePeoplePayloads } from './fileEngine'
import type { SyncPayload } from '@/sync/types'

/** The People WebDAV engine's `${storageKeyPrefix}-cloud-sync-local-modified`. */
export const PEOPLE_LOCAL_MODIFIED_KEY = 'lastglance-people-cloud-sync-local-modified'

/** Does a People payload carry anything worth restoring. */
export function peoplePayloadHasData(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  const n = (v: unknown) => (Array.isArray(v) ? v.length : 0)
  return n(d.people) + n(d.interactions) + n(d.personDates) + n(d.personCircles) > 0
}

export function runPeopleDirectAccessCycle(
  deps: DirectAccessCycleDeps,
  state: SnapshotFileState | null | undefined,
): Promise<{ state: Required<SnapshotFileState>; outcome: SnapshotFileOutcome }> {
  return runDirectAccessCycle({
    // The chore cycle's payload type is the chore SyncPayload; People's has its own arrays.
    buildPayload: buildPeoplePayload as unknown as () => Promise<SyncPayload>,
    applyPayload: applyPeoplePayload,
    mergePayloads: mergePeoplePayloads,
    lastLocalEditAt: lastPeopleLocalEditAt,
    localModifiedKey: PEOPLE_LOCAL_MODIFIED_KEY,
    hasData: peoplePayloadHasData,
    ...deps,
  }, state)
}
