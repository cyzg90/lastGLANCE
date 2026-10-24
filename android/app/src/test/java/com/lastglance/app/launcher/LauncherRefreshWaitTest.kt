package com.lastglance.app.launcher

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** When the awake hold may end: once the web layer has recorded an outcome for the request. */
class LauncherRefreshWaitTest {
    private fun entry(json: String) = JSONObject(json)

    @Test
    fun `a request still queued is waited on`() {
        assertFalse(LauncherRefreshWait.answered(entry("""{"clientId":"c1","outcome":"queued","liveness":"alive"}""")))
        assertFalse(LauncherRefreshWait.answered(entry("""{"clientId":"c1","outcome":"queued","finishedAt":null}""")))
    }

    @Test
    fun `an outcome or a finish stamp ends the wait`() {
        assertTrue(LauncherRefreshWait.answered(entry("""{"clientId":"c1","outcome":"ran","durationMs":240,"finishedAt":1}""")))
        assertTrue(LauncherRefreshWait.answered(entry("""{"clientId":"c1","outcome":"failed","reason":"vault: offline"}""")))
        assertTrue(LauncherRefreshWait.answered(entry("""{"clientId":"c1","outcome":"queued","finishedAt":1792644336246}""")))
    }

    @Test
    fun `a request no longer in the log is nothing to wait for`() {
        assertTrue(LauncherRefreshWait.answered(null))
    }

    @Test
    fun `a hold that ran out on a waiting request marks it unanswered, with how late the hold began`() {
        val patch = LauncherRefreshWait.unansweredPatch(
            JSONObject("""{"clientId":"c1","outcome":"queued","requestedAt":1000}"""), heldFrom = 4_000, now = 64_000,
        )!!
        assertEquals("unanswered", patch.getString("outcome"))
        assertEquals("the app did not answer while held awake for 60 s (the hold began 3 s after the request)", patch.getString("reason"))
        assertEquals(64_000L, patch.getLong("finishedAt"))
        assertTrue(LauncherRefreshWait.answered(JSONObject(patch.toString())))
    }

    @Test
    fun `an answer that landed before the hold ran out is never overwritten`() {
        assertNull(LauncherRefreshWait.unansweredPatch(JSONObject("""{"clientId":"c1","outcome":"ran","requestedAt":1000}"""), 4_000, 64_000))
        assertNull(LauncherRefreshWait.unansweredPatch(JSONObject("""{"clientId":"c1","outcome":"failed","reason":"x"}"""), 4_000, 64_000))
    }
}
