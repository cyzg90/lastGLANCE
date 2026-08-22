import { useEffect } from 'react'
import { drainWidgetCompletions } from '@/native/pendingCompletions'
import { isNativeShell } from '@/native/platform'

// Drains widget-originated completions into the DB on mount and whenever the app
// returns to the foreground (when a widget tap may have queued one while we were
// away). Runs in both native shells — Android widget taps and iOS AppIntent taps
// feed the same queue shape — and no-ops on web/PWA.
export function usePendingCompletions(): void {
  useEffect(() => {
    if (!isNativeShell()) return

    drainWidgetCompletions()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') drainWidgetCompletions()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
}
