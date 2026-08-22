import { useEffect } from 'react'
import { routeWidgetDeepLink } from '@/native/pendingDeepLink'
import { isNativeShell } from '@/native/platform'

// Consume a widget body-tap / shortcut deep link on mount and on each return to
// foreground. Runs in both native shells — MainActivity and the iOS AppDelegate
// stash the identical token forms — and no-ops on web/PWA.
export function usePendingDeepLink(): void {
  useEffect(() => {
    if (!isNativeShell()) return

    routeWidgetDeepLink()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') routeWidgetDeepLink()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
}
