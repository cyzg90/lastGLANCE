// The People half of processNotifyEnvelope's deps, shared by the three
// intents receive paths (WebDAV, GLANCEvault, Direct Access).

import { getMeUserSyncId, getMultiUserEnabled } from '@/multiuser/settings'
import type { PeopleNotifyDeps } from '@/intents/processNotifyEnvelope'
import { suggestedChannel, visibleToMe } from './home'
import { getPeople, interactionExists, logInteraction } from './queries'

export const peopleNotifyDeps: PeopleNotifyDeps = {
  getPerson: async (syncId) => {
    const p = visibleToMe(await getPeople(), getMultiUserEnabled(), getMeUserSyncId()).find(x => x.sync_id === syncId)
    return p ? { name: p.name, channel: suggestedChannel(p) ?? 'other' } : undefined
  },
  interactionExists,
  logContact: async ({ personSyncId, channel, occurredAt, syncId }) => {
    await logInteraction({
      person_sync_ids: [personSyncId],
      channel,
      direction: 'outbound',
      ...(occurredAt && { occurred_at: occurredAt }),
      sync_id: syncId,
      source: 'intent',
    })
  },
}
