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
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider

// The People "Reach out" widget (docs: the People spec, Widgets): the top five
// of the app's Reach out list, each with its recency bar and the card's reason
// line. Tapping a row opens quick-log for that person; the title opens People.
// Built like SoonListWidget, minus the Done chip: logging needs the sheet.
class ReachOutWidget : GlanceAppWidget() {
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
                data.labels.reachOut,
                style = TextStyle(
                    color = GlanceTheme.colors.onSurfaceVariant,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                ),
                modifier = GlanceModifier
                    .padding(bottom = 8.dp)
                    .clickable(actionStartActivity(openPeopleIntent(context))),
            )
            if (data.reachOut.isEmpty()) {
                Text(
                    data.labels.reachOutEmpty,
                    style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp),
                    modifier = GlanceModifier.clickable(actionStartActivity(openPeopleIntent(context))),
                )
            } else {
                LazyColumn {
                    items(data.reachOut) { row -> PersonRow(context, row) }
                }
            }
        }
    }

    @Composable
    private fun PersonRow(context: Context, row: ReachOutRow) {
        Row(
            modifier = GlanceModifier
                .fillMaxWidth()
                .padding(vertical = 5.dp)
                .clickable(actionStartActivity(logPersonIntent(context, row.syncId))),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Spacer(
                modifier = GlanceModifier
                    .width(5.dp)
                    .height(26.dp)
                    .cornerRadius(2.dp)
                    .background(ColorProvider(Color(row.colorInt))),
            )
            Spacer(modifier = GlanceModifier.width(8.dp))
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
                    row.detail,
                    maxLines = 1,
                    style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 11.sp),
                )
            }
        }
    }
}

class ReachOutWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ReachOutWidget()
}
