package com.lastglance.app;

import android.content.res.Resources;
import android.icu.util.ULocale;

import java.util.Locale;

// The device's first day of the week, 0 = Sunday … 6 = Saturday (issue #362).
//
// Read from the SYSTEM locale, not the app's: a per-app language set on
// Android 13+ ("en", with no region) would otherwise hide the device region,
// which is what decides the week start. Android 14's Regional preferences
// "First day of week" travels as the locale's -u-fw- extension and wins over
// the region's default.
public final class SystemWeekStart {
    private SystemWeekStart() {}

    public static int get() {
        try {
            Locale locale = Resources.getSystem().getConfiguration().getLocales().get(0);
            String fw = locale.getUnicodeLocaleType("fw");
            if (fw != null) {
                switch (fw) {
                    case "sun": return 0;
                    case "mon": return 1;
                    case "tue": return 2;
                    case "wed": return 3;
                    case "thu": return 4;
                    case "fri": return 5;
                    case "sat": return 6;
                    default: break;
                }
            }
            // ICU numbers days 1 = Sunday … 7 = Saturday.
            int first = android.icu.util.Calendar.getInstance(ULocale.forLocale(locale)).getFirstDayOfWeek();
            return (first - 1 + 7) % 7;
        } catch (Exception e) {
            return 0;
        }
    }
}
