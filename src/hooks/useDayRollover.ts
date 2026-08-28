import { useEffect, useRef } from 'react'
import dayjs from 'dayjs'

/**
 * Keeps date-derived UI honest about what time it actually is.
 *
 * Every date in the app is computed live from the system clock — `elapsed_days`
 * inside the query (db/queries.ts), the heatmap's "today" column, "yesterday"
 * vs "N days ago". None of it is cached. But nothing recomputes it either:
 * chore data loads on mount and on edits, so a tab left open shows whatever the
 * clock said when the data last loaded. Leave lastGLANCE open overnight and it
 * still calls yesterday "today".
 *
 * Two wake signals, deliberately no polling interval:
 *
 *   • Local midnight, when every calendar-derived label changes at once.
 *   • Tab becoming visible, which also heals the sub-day drift ("2 hours ago"
 *     when you come back at 6pm) and is the ONLY signal that works on native,
 *     where the OS suspends timers outright while the app is backgrounded.
 */

/**
 * Milliseconds until the next local midnight.
 *
 * Derived from the clock on every call rather than a 24h constant: local days
 * are 23 or 25 hours long across a DST shift, and a timer chained at a fixed
 * +24h would drift a full hour off the boundary it exists to catch.
 *
 * Always >= 1, so a caller re-arming on every fire can never spin.
 */
export function msUntilNextLocalMidnight(now: number = Date.now()): number {
  const next = dayjs(now).add(1, 'day').startOf('day').valueOf()
  return Math.max(1, next - now)
}

/** The current local calendar day, as the key we compare rollovers against. */
export function localDayKey(now: number = Date.now()): string {
  return dayjs(now).format('YYYY-MM-DD')
}

/**
 * Calls `onRefresh` when the calendar day rolls over, and whenever the tab
 * becomes visible.
 *
 * `onRefresh` is read through a ref, so a caller passing an inline closure does
 * not tear down and re-arm the timer on every render.
 */
export function useDayRollover(onRefresh: () => void): void {
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => { onRefreshRef.current = onRefresh }, [onRefresh])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    // Seeded at mount so the first midnight fire has something to compare to.
    let lastDay = localDayKey()

    function arm() {
      if (timer) clearTimeout(timer)
      // Re-read the clock on every arm. A timer that chained a fixed interval
      // from its own last fire would inherit each of these errors permanently:
      // background throttling delays a hidden tab's fire, machine sleep skips
      // it, DST moves the boundary, and a system clock correction (issue #306)
      // invalidates the delay outright.
      timer = setTimeout(onMidnight, msUntilNextLocalMidnight())
    }

    function onMidnight() {
      const today = localDayKey()
      // Guarded rather than assumed: a throttled or clock-shifted fire can land
      // on the same day it was armed in, and refreshing then would be pointless
      // churn. The comparison also catches a clock moved *backwards* past a
      // boundary, which a "did we pass midnight yet" check would miss.
      if (today !== lastDay) {
        lastDay = today
        onRefreshRef.current()
      }
      arm()
    }

    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      // Unguarded by design: returning to the tab refreshes regardless of
      // whether the date changed, which is what fixes same-day drift. This is
      // bounded by the user's attention rather than by a clock, so it cannot
      // produce a refresh nobody asked for. The existing sync-on-visible in
      // App.tsx already does strictly more work on this same event.
      lastDay = localDayKey()
      onRefreshRef.current()
      // The clock may have moved arbitrarily while we were hidden, so the
      // pending timer's delay is no longer trustworthy.
      arm()
    }

    arm()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])
}
