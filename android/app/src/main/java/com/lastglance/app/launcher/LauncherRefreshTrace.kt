package com.lastglance.app.launcher

import android.content.Context
import com.lastglance.app.SharedDataStore

/**
 * How far a live REFRESH got, stamped on its log entry on the way so an
 * unanswered one says where it stopped (LauncherRefreshWait.unansweredPatch):
 * the wake reached the app ([markWoken]), then the page took the request off
 * the queue ([markPickedUp]). Each is written once, and never on an answered entry.
 */
object LauncherRefreshTrace {
    /** The app's wake receiver ran: stamp the newest request still waiting. */
    @JvmStatic
    @JvmOverloads
    fun markWoken(context: Context, now: Long = System.currentTimeMillis()) {
        val clientId = SharedDataStore.lastLauncherRefresh(context)?.optString("clientId")?.takeIf { it.isNotEmpty() } ?: return
        SharedDataStore.updateLauncherRefreshIf(context, clientId) { LauncherRefreshWait.stampPatch(it, LauncherRefreshWait.WOKEN_AT, now) }
    }

    /** The page drained the launcher queue: stamp each REFRESH it took. */
    fun markPickedUp(context: Context, drainedJson: String, now: Long = System.currentTimeMillis()) {
        for (clientId in LauncherRefreshWait.refreshIds(drainedJson, LauncherIntentReceiver.ACTION_REFRESH)) {
            SharedDataStore.updateLauncherRefreshIf(context, clientId) { LauncherRefreshWait.stampPatch(it, LauncherRefreshWait.PICKED_UP_AT, now) }
        }
    }
}
