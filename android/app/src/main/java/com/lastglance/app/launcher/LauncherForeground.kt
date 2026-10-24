package com.lastglance.app.launcher

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo
import com.lastglance.app.R

/**
 * The notification an expedited launcher job needs below Android 12, where it
 * runs as a foreground service ([LauncherAwakeWorker], [LauncherRefreshWorker]);
 * from 12 on it is a JobScheduler expedited job and this is never shown. A quiet
 * one on its own minimum-importance channel.
 */
object LauncherForeground {
    private const val CHANNEL_ID = "launcher_refresh"

    fun info(context: Context, notificationId: Int): ForegroundInfo {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                manager.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, context.getString(R.string.launcher_refresh_channel), NotificationManager.IMPORTANCE_MIN),
                )
            }
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(context.getString(R.string.launcher_refresh_notification))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
        return ForegroundInfo(notificationId, notification)
    }
}
