package com.lastglance.app.glance

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider

// The People "Coming up" widget (docs: the People spec, Widgets): the next
// three dates, each as day and month beside the name, what it is and how far
// off. Dates in the coming week are pink, like the app's tiles. Tapping a row
// opens the person; the title opens People.
private const val SHOWN = 3
private val SOON_PINK = Color(0xFFF472B6)

class ComingUpWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val data = PeopleSnapshot.read(context)
        provideContent {
            GlanceTheme {
                Content(context, data)
            }
        }
    }

    @Composable
    private fun Content(context: Context, data: PeopleData) {
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(GlanceTheme.colors.surface)
                .cornerRadius(16.dp)
                .padding(12.dp),
        ) {
            Text(
                data.labels.comingUp,
                style = TextStyle(
                    color = GlanceTheme.colors.onSurfaceVariant,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                ),
                modifier = GlanceModifier
                    .padding(bottom = 8.dp)
                    .clickable(actionStartActivity(openPeopleIntent(context))),
            )
            val rows = data.comingUp.take(SHOWN)
            if (rows.isEmpty()) {
                Text(
                    data.labels.comingUpEmpty,
                    style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp),
                    modifier = GlanceModifier.clickable(actionStartActivity(openPeopleIntent(context))),
                )
            } else {
                for (row in rows) DateRow(context, row, data.labels)
            }
        }
    }

    @Composable
    private fun DateRow(context: Context, row: ComingUpRow, labels: PeopleLabels) {
        val soon = row.daysUntil <= 7
        Row(
            modifier = GlanceModifier
                .fillMaxWidth()
                .padding(vertical = 4.dp)
                .clickable(actionStartActivity(openPersonIntent(context, row.personSyncId))),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = GlanceModifier.width(36.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    row.day.toString(),
                    style = TextStyle(
                        color = if (soon) ColorProvider(SOON_PINK) else GlanceTheme.colors.onSurface,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        textAlign = TextAlign.Center,
                    ),
                )
                Text(
                    row.month.uppercase(),
                    style = TextStyle(
                        color = GlanceTheme.colors.onSurfaceVariant,
                        fontSize = 9.sp,
                        textAlign = TextAlign.Center,
                    ),
                )
            }
            Spacer(modifier = GlanceModifier.width(10.dp))
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(
                    row.name,
                    maxLines = 1,
                    style = TextStyle(
                        color = GlanceTheme.colors.onSurface,
                        fontWeight = FontWeight.Medium,
                        fontSize = 14.sp,
                    ),
                )
                Text(
                    "${row.label} · ${labels.daysUntil(row.daysUntil)}",
                    maxLines = 1,
                    style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 11.sp),
                )
            }
        }
    }
}

class ComingUpWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ComingUpWidget()
}
