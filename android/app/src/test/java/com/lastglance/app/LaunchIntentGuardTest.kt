package com.lastglance.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for the sticky-launch-intent guard. An Activity's launch Intent is
 * not consumed by being read: Android keeps it on the task and replays it on
 * every recreation, so a task rooted by the Add-chore widget would reopen the
 * new-chore form on each return once the process had been reclaimed.
 *
 * Runs on a plain JVM. LaunchIntentGuard takes primitives precisely so these
 * cases need no Android SDK stubs; the flag constant is inlined by javac.
 */
class LaunchIntentGuardTest {

    // android.content.Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY
    private val fromHistory = 0x00100000

    // Flags a widget tap actually carries: NEW_TASK or SINGLE_TOP.
    private val widgetTap = 0x10000000 or 0x20000000

    @Test
    fun `captures a genuine fresh launch`() {
        assertTrue(LaunchIntentGuard.shouldCapture(0, false))
        assertTrue(LaunchIntentGuard.shouldCapture(widgetTap, false))
    }

    @Test
    fun `skips a relaunch from the recents list`() {
        assertFalse(LaunchIntentGuard.shouldCapture(fromHistory, false))
    }

    @Test
    fun `skips the widget's own intent once it is replayed from recents`() {
        // The exact reported case: the task was rooted by the Add-chore widget,
        // the process was reclaimed, and the user reopened from recents. Same
        // flags as the original tap, plus the history marker.
        assertTrue(LaunchIntentGuard.shouldCapture(widgetTap, false))
        assertFalse(LaunchIntentGuard.shouldCapture(widgetTap or fromHistory, false))
    }

    @Test
    fun `skips a system-rebuilt activity even without the history flag`() {
        // Process death restore replays the rooting intent verbatim, and does not
        // always mark it as coming from history — savedInstanceState is what
        // identifies it.
        assertFalse(LaunchIntentGuard.shouldCapture(0, true))
        assertFalse(LaunchIntentGuard.shouldCapture(widgetTap, true))
    }

    @Test
    fun `ignores unrelated flags`() {
        // Any other flag in the word must not be mistaken for the history marker.
        val unrelated = 0x00000001 or 0x00800000 or 0x02000000
        assertTrue(LaunchIntentGuard.shouldCapture(unrelated, false))
        assertFalse(LaunchIntentGuard.shouldCapture(unrelated or fromHistory, false))
    }
}
