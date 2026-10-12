// Whether any outbound intents transport is on: the one question behind the
// send-to-dayGLANCE buttons, the notification action and the emit targets.
// Three transports, three independent switches (docs/direct-access.md):
// the WebDAV intents config, the GLANCEvault opt-in, and the Direct Access
// opt-in, which also needs a folder connected on this device. Gating on one
// or two of them hid the buttons for setups that used only the third, twice.

import { getIntentsConfig, isIntentsConfigured } from './config'
import { isDbIntentsEnabled } from './dbConfig'
import { getDirectAccessIntentsEnabledFlag } from './directAccessIntentsConfig'
import { directAccessTransport, type DirectAccessSnapshot } from '@/sync/directAccess'

export interface IntentsTransportsOn { webdav: boolean; vault: boolean; directAccess: boolean }

/** Pure: is at least one transport on. */
export const anyIntentsTransportOn = (on: IntentsTransportsOn): boolean => on.webdav || on.vault || on.directAccess

/**
 * The three switches as they stand. `directAccess` takes the transport's
 * snapshot so a React caller can pass the one it subscribes to; the status is
 * 'unknown' until the shell has restored the folder, so a caller that reads
 * it once at mount sees no folder and has to re-read when it connects.
 */
export function intentsTransportsOn(directAccess: Pick<DirectAccessSnapshot, 'supported' | 'connected'> = directAccessTransport.getSnapshot()): IntentsTransportsOn {
  return {
    webdav: isIntentsConfigured(getIntentsConfig()),
    vault: isDbIntentsEnabled(),
    directAccess: getDirectAccessIntentsEnabledFlag() && directAccess.supported && directAccess.connected,
  }
}
