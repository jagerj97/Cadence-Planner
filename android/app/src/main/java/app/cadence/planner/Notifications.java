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

    static void show(Context context, String title, String body, int id) {
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Cadence reminders", NotificationManager.IMPORTANCE_DEFAULT));
        Intent launch = new Intent(context, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(context, 0, launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.notify(id, new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification).setColor(Color.rgb(214, 96, 57))
            .setContentTitle(title).setContentText(body)
            .setAutoCancel(true).setContentIntent(pending).build());
    }

    private static PendingIntent intent(Context context, int code, String title, String body) {
        Intent alarm = new Intent(context, AlarmReceiver.class);
        alarm.putExtra("title", title);
        alarm.putExtra("body", body);
        alarm.putExtra("id", code);
        return PendingIntent.getBroadcast(context, code, alarm,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void set(Context context, int code, long at, String title, String body) {
        if (at <= System.currentTimeMillis()) return;
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent(context, code, title, body));
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
                    event.optString("title", "Cadence"), event.optString("body", ""));
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
        set(context, FOCUS_CODE, at, title, body);
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
            if (intent.getIntExtra("id", 1) == FOCUS_CODE) {
                SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                prefs.edit().putLong("firedFocusAt", prefs.getLong("focusAt", 0)).apply();
            }
            show(context, intent.getStringExtra("title"), intent.getStringExtra("body"), intent.getIntExtra("id", 1));
        }
    }

    public static class BootReceiver extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            scheduleItems(context, prefs.getString("items", "[]"));
            long focusAt = prefs.getLong("focusAt", 0);
            if (focusAt > System.currentTimeMillis()) set(context, FOCUS_CODE, focusAt,
                prefs.getString("focusTitle", "Focus session complete"),
                prefs.getString("focusBody", ""));
        }
    }
}
