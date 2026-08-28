package com.lastglance.app;

import android.content.Intent;

// Decides whether an inbound Activity Intent is a genuine new launch, or Android
// replaying the one that already rooted this task.
//
// An Activity's launch Intent is sticky: reading it does not consume it, and the
// system hands the SAME Intent back every time it recreates the activity. So a
// task first opened from the Add-chore widget carries lastglance://action/add as
// its root intent for as long as that task lives, and MainActivity's captures
// re-fire it on every recreation — reopening the new-chore form unprompted after
// the process is reclaimed, re-prefilling a long-gone share, or replaying a
// Tasker CREATE.
//
// Deliberately free of Android types at runtime: the flag below is a
// compile-time constant that javac inlines, so this rule is unit-testable on a
// plain JVM with no SDK stubs on the classpath. Keep it that way — take
// primitives here, and read them off the Intent at the call site.
final class LaunchIntentGuard {

    private LaunchIntentGuard() {}

    /**
     * @param intentFlags        the inbound intent's getFlags()
     * @param isRestoredInstance true when onCreate was handed a non-null saved
     *                           instance state, i.e. the system is rebuilding an
     *                           activity it had previously killed
     * @return true when the intent's payload should be captured
     */
    static boolean shouldCapture(int intentFlags, boolean isRestoredInstance) {
        // Rebuilding a killed activity re-delivers the intent that started it.
        // Nothing new arrived, and that payload was consumed long ago.
        if (isRestoredInstance) return false;
        // Set by the system when the activity is launched from the recents /
        // history list rather than by a fresh dispatch. This is the case the bug
        // reports describe: leave the app, come back via recents, land on Add.
        return (intentFlags & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0;
    }
}
