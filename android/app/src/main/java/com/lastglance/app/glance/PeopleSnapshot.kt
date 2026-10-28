package com.lastglance.app.glance

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.lastglance.app.MainActivity
import com.lastglance.app.SharedDataStore
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

// The People widgets (Reach out, Coming up) read the snapshot's `people` block
// (src/native/peopleSnapshot.ts). The app bakes every People word into it in
// its own language, so these widgets carry no People strings of their own.
// Dates come as local days and are counted here, so "tomorrow" is right on
// whatever day the widget renders. A snapshot from before the block, or an
// unreadable one, reads as empty.

internal data class ReachOutRow(
    val syncId: String,
    val name: String,
    val detail: String,
    val colorInt: Int,
)

internal data class ComingUpRow(
    val personSyncId: String,
    val name: String,
    val label: String,
    val day: Int,
    val month: String,
    val daysUntil: Int,
)

internal data class PeopleLabels(
    val reachOut: String,
    val comingUp: String,
    val reachOutEmpty: String,
    val comingUpEmpty: String,
    val today: String,
    val tomorrow: String,
    val inDays: String,
) {
    fun daysUntil(n: Int): String = when (n) {
        0 -> today
        1 -> tomorrow
        else -> inDays.replace("{{count}}", n.toString())
    }
}

internal data class PeopleData(
    val labels: PeopleLabels,
    val reachOut: List<ReachOutRow>,
    val comingUp: List<ComingUpRow>,
)

// Pink for someone on Reach out for a date alone, as in the app.
private const val DATE_COLOR = "#f472b6"

internal object PeopleSnapshot {
    fun read(context: Context): PeopleData {
        val root = try {
            SharedDataStore.readSnapshot(context)?.let { JSONObject(it).optJSONObject("people") }
        } catch (e: Exception) {
            null
        }
        val l = root?.optJSONObject("labels")
        val labels = PeopleLabels(
            reachOut = l?.optString("reachOut").orEmpty().ifEmpty { "Reach out" },
            comingUp = l?.optString("comingUp").orEmpty().ifEmpty { "Coming up" },
            reachOutEmpty = l?.optString("reachOutEmpty").orEmpty(),
            comingUpEmpty = l?.optString("comingUpEmpty").orEmpty(),
            today = l?.optString("today").orEmpty().ifEmpty { "today" },
            tomorrow = l?.optString("tomorrow").orEmpty().ifEmpty { "tomorrow" },
            inDays = l?.optString("inDays").orEmpty().ifEmpty { "{{count}}d" },
        )
        if (root == null) return PeopleData(labels, emptyList(), emptyList())
        return PeopleData(labels, reachOut(root), comingUp(root))
    }

    private fun reachOut(root: JSONObject): List<ReachOutRow> {
        val arr = root.optJSONArray("reachOut") ?: return emptyList()
        val out = ArrayList<ReachOutRow>()
        for (i in 0 until arr.length()) {
            val r = arr.optJSONObject(i) ?: continue
            val syncId = r.optString("syncId")
            if (syncId.isEmpty()) continue
            out.add(
                ReachOutRow(
                    syncId = syncId,
                    name = r.optString("name"),
                    detail = r.optString("detail"),
                    colorInt = parseColor(r.optString("color", DATE_COLOR)),
                ),
            )
        }
        return out
    }

    // Dates already past (the snapshot is older than today) are dropped.
    private fun comingUp(root: JSONObject): List<ComingUpRow> {
        val arr = root.optJSONArray("comingUp") ?: return emptyList()
        val dayFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { isLenient = false }
        val monthFmt = SimpleDateFormat("MMM", Locale.getDefault())
        val today = startOfDay(Calendar.getInstance())
        val out = ArrayList<ComingUpRow>()
        for (i in 0 until arr.length()) {
            val d = arr.optJSONObject(i) ?: continue
            val date = try { dayFmt.parse(d.optString("on")) } catch (e: Exception) { null } ?: continue
            val on = startOfDay(Calendar.getInstance().apply { time = date })
            val days = Math.round((on.timeInMillis - today.timeInMillis) / 86_400_000.0).toInt()
            if (days < 0) continue
            out.add(
                ComingUpRow(
                    personSyncId = d.optString("personSyncId"),
                    name = d.optString("name"),
                    label = d.optString("label"),
                    day = on.get(Calendar.DAY_OF_MONTH),
                    month = monthFmt.format(on.time),
                    daysUntil = days,
                ),
            )
        }
        return out
    }

    private fun startOfDay(c: Calendar): Calendar = c.apply {
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }

    private fun parseColor(hex: String): Int = try {
        android.graphics.Color.parseColor(hex)
    } catch (e: Exception) {
        android.graphics.Color.parseColor(DATE_COLOR)
    }
}

// Launch intents for People taps; MainActivity maps them to the tokens the
// app routes (person:, log:, people). Each carries its own data URI so the
// rows' PendingIntents stay distinct.
internal fun openPersonIntent(context: Context, syncId: String): Intent =
    peopleIntent(context, "lastglance://person/$syncId")

internal fun logPersonIntent(context: Context, syncId: String): Intent =
    peopleIntent(context, "lastglance://log/$syncId")

internal fun openPeopleIntent(context: Context): Intent =
    peopleIntent(context, "lastglance://people")

private fun peopleIntent(context: Context, uri: String): Intent =
    Intent(context, MainActivity::class.java)
        .setAction(Intent.ACTION_VIEW)
        .setData(Uri.parse(uri))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
