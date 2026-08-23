import { useEffect } from 'react'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { PluginListenerHandle } from '@capacitor/core'
import i18n from 'i18next'
import { syncReminders, handleNotificationAction } from '@/native/reminders'
import { isNativeShell } from '@/native/platform'

// Keeps the native reminder set in sync with the chores, on the same signals as
// the widget snapshot, and routes notification taps to the chore. Runs in both
// native shells; no-op on web/PWA (syncReminders also guards internally).
export function useReminders(): void {
  useEffect(() => {
    if (!isNativeShell()) return

    syncReminders()

    const onChange = () => { syncReminders() }
    window.addEventListener('lg:chore-logged', onChange)
    window.addEventListener('lg:sync-applied', onChange)
    // Notification text is baked at schedule time, so a language switch must
    // re-run the sync: the body diff in syncReminders then re-bakes every
    // pending reminder (and the channel/action labels re-register) in the new
    // language.
    i18n.on('languageChanged', onChange)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncReminders()
    }
    document.addEventListener('visibilitychange', onVisibility)

    let tapHandle: PluginListenerHandle | undefined
    LocalNotifications.addListener('localNotificationActionPerformed', action => {
      handleNotificationAction(action.actionId, action.notification.extra)
    }).then(handle => { tapHandle = handle })

    return () => {
      window.removeEventListener('lg:chore-logged', onChange)
      window.removeEventListener('lg:sync-applied', onChange)
      i18n.off('languageChanged', onChange)
      document.removeEventListener('visibilitychange', onVisibility)
      tapHandle?.remove()
    }
  }, [])
}
