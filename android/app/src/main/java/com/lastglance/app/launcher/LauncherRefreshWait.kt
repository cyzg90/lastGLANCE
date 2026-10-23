package com.lastglance.app.launcher

import org.json.JSONObject

/** When a live renderer has answered a REFRESH. Pure, tested on the JVM. */
object LauncherRefreshWait {

    /**
     * True once the entry has an outcome the web layer recorded: anything but
     * queued, or a finish stamp. A missing entry (pruned from the log, or never
     * written) is nothing to wait for.
     */
    fun answered(entry: JSONObject?): Boolean {
        if (entry == null) return true
        if (entry.has("finishedAt") && !entry.isNull("finishedAt")) return true
        return entry.optString("outcome") != "queued"
    }

    /**
     * What [LauncherAwakeWorker] writes when its hold ran out with the entry
     * still waiting: `unanswered`, with how late the hold began, so a request
     * the web layer never took is not left reading `queued` forever, and a
     * job Android held back shows as one. Null once answered.
     */
    fun unansweredPatch(entry: JSONObject, heldFrom: Long, now: Long): JSONObject? {
        if (answered(entry)) return null
        val requestedAt = entry.optLong("requestedAt", heldFrom)
        val lateSec = ((heldFrom - requestedAt).coerceAtLeast(0) + 500) / 1000
        val heldSec = ((now - heldFrom).coerceAtLeast(0) + 500) / 1000
        return JSONObject()
            .put("outcome", "unanswered")
            .put("reason", "the app did not answer while held awake for $heldSec s (the hold began $lateSec s after the request)")
            .put("holdStartedAt", heldFrom)
            .put("finishedAt", now)
    }
}
