package app.cadence.planner;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.Locale;

/**
 * The ongoing "timer running" notification, like the Clock app's: a live countdown with
 * Pause/Resume and Stop. The timer's state is the JSON the web app saves in "cadence_focus"
 * (plannedSec, accSec, runStart, ...), so the buttons work even when the app is closed.
 */
final class FocusTimer {
    // Normal importance (so it sits with the alerting notifications, like the Clock timer) but silent.
    // A channel's importance can't be raised after creation, hence a new id for the old low one.
    static final String CHANNEL = "cadence_timer_live";
    private static final String OLD_CHANNEL = "cadence_timer";
    static final int NOTIFICATION_ID = 500002;
    private static final String PREFS = "cadence_focus";
    static final String ACTION_PAUSE = "app.cadence.planner.TIMER_PAUSE";
    static final String ACTION_RESUME = "app.cadence.planner.TIMER_RESUME";
    static final String ACTION_STOP = "app.cadence.planner.TIMER_STOP";

    /** The open activity, so a button tap can tell the web app to reload the timer. */
    static volatile WeakReference<MainActivity> activity = new WeakReference<>(null);

    static JSONObject state(Context context) {
        try {
            String json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("state", "null");
            return json == null || "null".equals(json) ? null : new JSONObject(json);
        } catch (Exception e) {
            return null;
        }
    }

    private static void save(Context context, JSONObject state) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("state", state == null ? "null" : state.toString()).apply();
    }

    private static double elapsedSec(JSONObject state, long now) {
        double acc = state.optDouble("accSec", 0);
        return state.isNull("runStart") ? acc : acc + (now - state.optLong("runStart", now)) / 1000.0;
    }

    private static String clip(String text) {
        return text.length() > 120 ? text.substring(0, 119) + "…" : text;
    }

    private static String clock(long seconds) {
        seconds = Math.max(0, seconds);
        long h = seconds / 3600, m = (seconds % 3600) / 60, s = seconds % 60;
        return h > 0 ? String.format(Locale.US, "%d:%02d:%02d", h, m, s) : String.format(Locale.US, "%d:%02d", m, s);
    }

    private static Notification.Action action(Context context, String label, String action, int code) {
        Intent intent = new Intent(context, ActionReceiver.class).setAction(action);
        PendingIntent pending = PendingIntent.getBroadcast(context, code, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(Icon.createWithResource(context, R.drawable.ic_timer), label, pending).build();
    }

    private static void createChannel(NotificationManager manager) {
        if (manager.getNotificationChannel(OLD_CHANNEL) != null) manager.deleteNotificationChannel(OLD_CHANNEL);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Running timer", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("The countdown for a running focus or break timer");
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    /** Shows, refreshes, or removes the notification to match the saved timer. */
    static void update(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        JSONObject state = state(context);
        long now = System.currentTimeMillis();
        if (state == null) {
            manager.cancel(NOTIFICATION_ID);
            return;
        }
        double remaining = state.optDouble("plannedSec", 0) - elapsedSec(state, now);
        boolean running = !state.isNull("runStart");
        if ((running && remaining <= 0) || (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)) {
            manager.cancel(NOTIFICATION_ID);
            return;
        }
        createChannel(manager);

        boolean isBreak = "break".equals(state.optString("mode"));
        String kind = isBreak ? "Break" : "Focus";
        String task = isBreak ? "" : state.optString("title", "");
        String left = clock(Math.round(remaining));
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch != null) launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        PendingIntent open = launch == null ? null
            : PendingIntent.getActivity(context, NOTIFICATION_ID, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Android 16+ promotes this to a Live Update: a status bar chip with the countdown. These are the
        // extras Notification.Builder.setRequestPromotedOngoing / setShortCriticalText write (API 36);
        // older versions ignore them. Promotion also needs an ongoing, titled, non-colorized notification.
        Bundle live = new Bundle();
        live.putBoolean("android.requestPromotedOngoing", true);
        if (!running) live.putString("android.shortCriticalText", left); // the chip shows the countdown while running

        Notification.Builder notification = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_timer).setColor(Color.rgb(214, 96, 57))
            .setCategory(Notification.CATEGORY_STOPWATCH)
            .setOngoing(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(open)
            .addExtras(live);
        if (running) {
            long endAt = now + Math.round(remaining * 1000);
            String ends = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(new java.util.Date(endAt));
            notification.setContentTitle(kind)
                .setContentText(clip((task.isEmpty() ? "" : task + " · ") + "Ends at " + ends))
                .setWhen(endAt).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
                .setTimeoutAfter(Math.round(remaining * 1000) + 1000)
                .addAction(action(context, "Pause", ACTION_PAUSE, 1));
        } else {
            notification.setContentTitle(kind + " paused")
                .setContentText(clip((task.isEmpty() ? "" : task + " · ") + left + " left"))
                .setShowWhen(false)
                .addAction(action(context, "Resume", ACTION_RESUME, 2));
        }
        notification.addAction(action(context, "Stop", ACTION_STOP, 3));
        manager.notify(NOTIFICATION_ID, notification.build());
    }

    public static class ActionReceiver extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            JSONObject state = state(context);
            if (state == null || action == null) {
                update(context);
                return;
            }
            long now = System.currentTimeMillis();
            try {
                if (ACTION_PAUSE.equals(action) && !state.isNull("runStart")) {
                    state.put("accSec", elapsedSec(state, now));
                    state.put("runStart", JSONObject.NULL);
                    save(context, state);
                    Notifications.cancelFocus(context);
                } else if (ACTION_RESUME.equals(action) && state.isNull("runStart")) {
                    state.put("runStart", now);
                    save(context, state);
                    long endAt = now + Math.round((state.optDouble("plannedSec", 0) - state.optDouble("accSec", 0)) * 1000);
                    boolean isBreak = "break".equals(state.optString("mode"));
                    Notifications.scheduleFocus(context, endAt,
                        isBreak ? "Break's over" : "Focus session complete",
                        isBreak ? "Ready for the next block?" : state.optString("title", ""));
                } else if (ACTION_STOP.equals(action)) {
                    // Leave the stopped session for the web app to log the next time it runs.
                    JSONObject stopped = new JSONObject(state.toString());
                    stopped.put("accSec", elapsedSec(state, now));
                    stopped.put("runStart", JSONObject.NULL);
                    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .putString("stopped", stopped.toString()).apply();
                    save(context, null);
                    Notifications.cancelFocus(context);
                }
            } catch (Exception ignored) {}
            update(context);
            MainActivity open = activity.get();
            if (open != null) open.focusChanged();
        }
    }

    /** Returns the session stopped from the notification (if any) and clears it. */
    static String takeStopped(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String stopped = prefs.getString("stopped", "null");
        prefs.edit().remove("stopped").apply();
        return stopped;
    }
}
