package app.cadence.planner;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

final class Notifications {
    static final String CHANNEL = "cadence_reminders";
    private static final String PREFS = "cadence_alarms";
    private static final int FOCUS_CODE = 500001;
    private static final String TICK = "app.cadence.planner.REMINDER_TICK";

    static void createChannel(Context context) {
        context.getSystemService(NotificationManager.class)
            .createNotificationChannel(new NotificationChannel(CHANNEL, "Cadence reminders", NotificationManager.IMPORTANCE_DEFAULT));
    }

    static void show(Context context, String title, String body, int id) {
        post(context, title, body, id, 0);
    }

    /** Posts (or quietly updates) a notification; `when` keeps an updated one's time from when it first arrived. */
    private static void post(Context context, String title, String body, int id, long when) {
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        createChannel(context);
        Intent launch = new Intent(context, AppActivity.class);
        PendingIntent pending = PendingIntent.getActivity(context, 0, launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(AppActivity.plain(context) ? R.drawable.ic_notification_plain : R.drawable.ic_notification).setColor(Color.rgb(214, 96, 57))
            .setContentTitle(title).setContentText(body).setOnlyAlertOnce(true)
            .setAutoCancel(true).setContentIntent(pending);
        if (when > 0) builder.setWhen(when);
        android.graphics.Bitmap logotype = AppActivity.notificationIcon(context);
        if (logotype != null) builder.setLargeIcon(logotype);
        manager.notify(id, builder.build());
    }

    /** "Starts in 7m", counting whole minutes up (so a 10 minute reminder reads 10m, not 9m). */
    static String startsIn(long start, long now) {
        long minutes = (start - now + 59999) / 60000;
        if (minutes <= 0) return "Starting now";
        long h = minutes / 60, m = minutes % 60;
        return "Starts in " + (h == 0 ? m + "m" : m == 0 ? h + "h" : h + "h " + m + "m");
    }

    /**
     * A reminder counts down to its start: it's posted with the time left, then updated each time the
     * minutes left drop, until it says "Starting now". Two reminders for the same start share one
     * notification. Swiping it away stops the countdown.
     */
    private static void countdown(Context context, String title, long start, long when, boolean first) {
        int id = 1000000 + ((title + "\0" + start).hashCode() & 0x3fffffff) % 1000000000;
        long now = System.currentTimeMillis();
        if (!first && !showing(context, id)) return;
        post(context, title, startsIn(start, now), id, when);
        long minutes = (start - now + 59999) / 60000;
        if (minutes <= 0) return;
        Intent tick = new Intent(context, AlarmReceiver.class).setAction(TICK);
        tick.putExtra("title", title);
        tick.putExtra("start", start);
        tick.putExtra("when", when);
        PendingIntent pending = PendingIntent.getBroadcast(context, id, tick,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        exact(context, start - (minutes - 1) * 60000, pending);
    }

    private static boolean showing(Context context, int id) {
        for (android.service.notification.StatusBarNotification shown :
            context.getSystemService(NotificationManager.class).getActiveNotifications()) {
            if (shown.getId() == id) return true;
        }
        return false;
    }

    private static PendingIntent intent(Context context, int code, String title, String body) {
        return intent(context, code, title, body, 0);
    }

    private static PendingIntent intent(Context context, int code, String title, String body, long start) {
        Intent alarm = new Intent(context, AlarmReceiver.class);
        alarm.putExtra("title", title);
        alarm.putExtra("body", body);
        alarm.putExtra("id", code);
        alarm.putExtra("start", start);
        return PendingIntent.getBroadcast(context, code, alarm,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * Reminders use exact alarms so they arrive on time; inexact ones are batched by Android and can
     * come several minutes late. Exact alarms need USE_EXACT_ALARM (Android 13+) or
     * SCHEDULE_EXACT_ALARM (Android 12); if the system still refuses, fall back to an inexact one.
     */
    private static void set(Context context, int code, long at, String title, String body, long start) {
        if (at <= System.currentTimeMillis()) return;
        exact(context, at, intent(context, code, title, body, start));
    }

    private static void exact(Context context, long at, PendingIntent pending) {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms();
        try {
            if (exact) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                return;
            }
        } catch (SecurityException ignored) {
            // The exact alarm permission was taken away; use an inexact alarm below.
        }
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
    }

    static void scheduleItems(Context context, String json) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        int oldCount = prefs.getInt("count", 0);
        for (int i = 0; i < oldCount; i++) manager.cancel(intent(context, i + 1, "", ""));
        try {
            JSONArray events = new JSONArray(json);
            int count = Math.min(128, events.length());
            for (int i = 0; i < count; i++) {
                JSONObject event = events.getJSONObject(i);
                set(context, i + 1, event.getLong("at"),
                    event.optString("title", "Cadence"), event.optString("body", ""), event.optLong("start", 0));
            }
            prefs.edit().putString("items", json).putInt("count", count).apply();
        } catch (Exception ignored) {}
    }

    static void scheduleFocus(Context context, long at, String title, String body) {
        cancelFocus(context);
        if (at <= System.currentTimeMillis()) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong("focusAt", at).putLong("firedFocusAt", 0)
            .putString("focusTitle", title).putString("focusBody", body).apply();
        set(context, FOCUS_CODE, at, title, body, 0);
    }

    static void cancelFocus(Context context) {
        context.getSystemService(AlarmManager.class).cancel(intent(context, FOCUS_CODE, "", ""));
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove("focusAt").remove("focusTitle").remove("focusBody").apply();
    }

    static synchronized void finishFocus(Context context, String title, String body) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean alreadySent = prefs.getLong("focusAt", 0) != 0 &&
            prefs.getLong("firedFocusAt", 0) == prefs.getLong("focusAt", 0);
        cancelFocus(context);
        if (!alreadySent) show(context, title, body, FOCUS_CODE);
    }

    public static class AlarmReceiver extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            String title = intent.getStringExtra("title");
            if (TICK.equals(intent.getAction())) {
                countdown(context, title, intent.getLongExtra("start", 0), intent.getLongExtra("when", 0), false);
                return;
            }
            long start = intent.getLongExtra("start", 0);
            if (start > 0) {
                countdown(context, title, start, System.currentTimeMillis(), true);
                return;
            }
            if (intent.getIntExtra("id", 1) == FOCUS_CODE) {
                SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                prefs.edit().putLong("firedFocusAt", prefs.getLong("focusAt", 0)).apply();
                context.getSystemService(NotificationManager.class).cancel(FocusTimer.NOTIFICATION_ID);
            }
            show(context, intent.getStringExtra("title"), intent.getStringExtra("body"), intent.getIntExtra("id", 1));
        }
    }

    public static class BootReceiver extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            scheduleItems(context, prefs.getString("items", "[]"));
            FocusTimer.update(context);
            long focusAt = prefs.getLong("focusAt", 0);
            if (focusAt > System.currentTimeMillis()) set(context, FOCUS_CODE, focusAt,
                prefs.getString("focusTitle", "Focus session complete"),
                prefs.getString("focusBody", ""), 0);
        }
    }
}
