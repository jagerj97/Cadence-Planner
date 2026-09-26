package app.cadence.planner;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StrikethroughSpan;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Locale;

/**
 * One home screen widget per Today card: Right now, Your day, Schedule, Tasks, and Habits. The web
 * app saves a week-long snapshot through the bridge (widget.ts); the widgets draw today's part in
 * the app's colors and work out "Right now" from the clock, so they keep up while the app is closed.
 * Tapping a task's checkbox or a habit's circle changes it right away here and is queued for the app,
 * which applies it the next time it runs (or at once if it's open).
 */
final class PanelWidgets {
    static final String PREFS = "cadence_widget";
    static final String ACTION_TICK = "app.cadence.planner.WIDGET_TICK";
    static final String ACTION_ITEM = "app.cadence.planner.WIDGET_ITEM";
    static final String EXTRA_ADD = "cadence_add";

    private PanelWidgets() {}

    // ---- snapshot ----

    static JSONObject snapshot(Context context) {
        try {
            return new JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("snapshot", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static JSONObject today(JSONObject snapshot) {
        JSONObject days = snapshot.optJSONObject("days");
        return days == null ? null : days.optJSONObject(LocalDate.now().toString());
    }

    /** Whether the phone is in dark mode; the widgets follow it rather than the app's own setting. */
    static boolean systemDark(Context context) {
        return (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    /** The snapshot's colors for the phone's current light or dark mode (older snapshots have one "theme"). */
    static WidgetTheme theme(Context context, JSONObject snapshot) {
        JSONObject themes = snapshot.optJSONObject("themes");
        if (themes == null) return new WidgetTheme(snapshot.optJSONObject("theme"));
        return new WidgetTheme(themes.optJSONObject(systemDark(context) ? "dark" : "light"));
    }

    /** Saves a new snapshot from the app and redraws every widget. */
    static void saveSnapshot(Context context, String json) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("snapshot", json).apply();
        refreshAll(context, true);
    }

    static final Class<?>[] PROVIDERS = { Now.class, Day.class, Schedule.class, Tasks.class, Habits.class };

    /** Redraws every widget. `full` also re-sends list data and scrolls the schedule to the current hour. */
    static void refreshAll(Context context, boolean full) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        boolean any = false;
        for (Class<?> provider : PROVIDERS) {
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, provider));
            if (ids.length == 0) continue;
            any = true;
            for (int id : ids) render(context, manager, provider, id, full);
            if (provider == Schedule.class) manager.notifyAppWidgetViewDataChanged(ids, R.id.schedule_list);
            if (provider == Tasks.class || provider == Habits.class) manager.notifyAppWidgetViewDataChanged(ids, R.id.list_rows);
        }
        if (any) scheduleTick(context);
    }

    // ---- formatting (matches fmtTime / fmtDur in cal.ts) ----

    static String time(int minutes) {
        int m = ((minutes % 1440) + 1440) % 1440, h = m / 60, r = m % 60;
        String suffix = h < 12 ? "AM" : "PM";
        int h12 = h % 12 == 0 ? 12 : h % 12;
        return r == 0 ? h12 + " " + suffix : String.format(Locale.US, "%d:%02d %s", h12, r, suffix);
    }

    static String duration(int minutes) {
        int m = Math.max(0, minutes), h = m / 60, r = m % 60;
        return h == 0 ? r + "m" : r == 0 ? h + "h" : h + "h " + r + "m";
    }

    static int nowMinutes() {
        LocalTime t = LocalTime.now();
        return t.getHour() * 60 + t.getMinute();
    }

    // ---- shared card pieces ----

    private static void paintCard(RemoteViews views, WidgetTheme theme, int bg, int border) {
        views.setInt(R.id.card_bg, "setColorFilter", bg);
        views.setInt(R.id.card_border, "setColorFilter", WidgetDraw.alpha(border, 0.62f));
    }

    private static PendingIntent openApp(Context context, int code, String add) {
        Intent launch = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (add != null) launch.putExtra(EXTRA_ADD, add).setData(Uri.parse("cadence-widget://add/" + add));
        return PendingIntent.getActivity(context, code, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** The widget's height in portrait, in dp (0 if the launcher hasn't said). */
    private static int heightDp(AppWidgetManager manager, int id) {
        Bundle options = manager.getAppWidgetOptions(id);
        return options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT);
    }

    private static int widthDp(AppWidgetManager manager, int id, int fallback) {
        Bundle options = manager.getAppWidgetOptions(id);
        int w = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH);
        return w > 0 ? w : fallback;
    }

    static void render(Context context, AppWidgetManager manager, Class<?> provider, int id, boolean full) {
        JSONObject snapshot = snapshot(context);
        WidgetTheme theme = theme(context, snapshot);
        JSONObject day = today(snapshot);
        RemoteViews views;
        if (provider == Now.class) views = renderNow(context, theme, day);
        else if (provider == Day.class) views = renderDay(context, manager, id, theme, day);
        else if (provider == Schedule.class) views = renderSchedule(context, id, theme, day, full);
        else views = renderList(context, id, provider == Tasks.class, theme, day);
        manager.updateAppWidget(id, views);
    }

    // ---- Right now ----

    private static RemoteViews renderNow(Context context, WidgetTheme theme, JSONObject day) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_now);
        paintCard(v, theme, theme.nowCard, theme.nowBorder);
        int now = nowMinutes();
        v.setTextColor(R.id.now_heading, theme.foreground);
        v.setOnClickPendingIntent(R.id.card_root, openApp(context, 800001, null));

        JSONObject current = null, next = null;
        JSONArray blocks = day == null ? null : day.optJSONArray("blocks");
        for (int i = 0; blocks != null && i < blocks.length(); i++) {
            JSONObject b = blocks.optJSONObject(i);
            if (b == null) continue;
            if (current == null && now >= b.optInt("start") && now < b.optInt("end")) current = b;
            String continues = b.optString("continues");
            if (next == null && b.optInt("start") > now && !"before".equals(continues)) next = b;
        }
        if (current != null) {
            int start = current.optInt("fullStart", current.optInt("start")), end = current.optInt("fullEnd", current.optInt("end"));
            int color = WidgetDraw.parse(current.optString("color"), theme.primary);
            v.setViewVisibility(R.id.now_current, View.VISIBLE);
            v.setViewVisibility(R.id.now_empty, View.GONE);
            v.setImageViewBitmap(R.id.now_ring, WidgetDraw.ring(context, (now - start) / (float) Math.max(1, end - start),
                color, theme.border, current.optString("kind")));
            v.setTextViewText(R.id.now_title, current.optString("title"));
            v.setTextColor(R.id.now_title, theme.foreground);
            v.setTextViewText(R.id.now_sub, duration(end - now) + " left · ends " + time(end));
            v.setTextColor(R.id.now_sub, theme.mutedForeground);
        } else {
            v.setViewVisibility(R.id.now_current, View.GONE);
            v.setViewVisibility(R.id.now_empty, View.VISIBLE);
            v.setTextColor(R.id.now_empty, theme.mutedForeground);
            if (day == null) v.setTextViewText(R.id.now_empty, "Open Cadence to load your day");
        }
        int nextVisibility = next == null ? View.GONE : View.VISIBLE;
        v.setViewVisibility(R.id.now_divider, nextVisibility);
        v.setViewVisibility(R.id.now_next, nextVisibility);
        if (next != null) {
            v.setInt(R.id.now_divider, "setColorFilter", theme.dark ? 0x1affffff : WidgetDraw.alpha(theme.nowBorder, 0.7f));
            v.setInt(R.id.now_next_dot, "setColorFilter", WidgetDraw.parse(next.optString("color"), theme.primary));
            v.setTextColor(R.id.now_next_label, theme.mutedForeground);
            v.setTextViewText(R.id.now_next_title, next.optString("title"));
            v.setTextColor(R.id.now_next_title, theme.foreground);
            v.setTextViewText(R.id.now_next_when, time(next.optInt("start")) + " · in " + duration(next.optInt("start") - now));
            v.setTextColor(R.id.now_next_when, theme.mutedForeground);
        }
        return v;
    }

    // ---- Your day ----

    private static RemoteViews renderDay(Context context, AppWidgetManager manager, int id, WidgetTheme theme, JSONObject day) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_day);
        paintCard(v, theme, theme.card, theme.border);
        v.setOnClickPendingIntent(R.id.card_root, openApp(context, 800002, null));
        v.setTextColor(R.id.day_heading, theme.foreground);
        // A 4x1 widget fits just the bar and totals; the heading comes back when it's resized taller.
        v.setViewVisibility(R.id.day_heading, heightDp(manager, id) >= 100 ? View.VISIBLE : View.GONE);
        int routine = WidgetDraw.alpha(theme.sleep, 0.72f);
        int[] colors = { theme.muted, routine, theme.primary };
        v.setImageViewBitmap(R.id.day_bar, WidgetDraw.dayBar(context, Math.max(100, widthDp(manager, id, 300) - 28), 12,
            day == null ? null : day.optJSONArray("spans"), colors));
        JSONArray totals = day == null ? null : day.optJSONArray("totals");
        int[][] stats = {
            { R.id.day_dot_routine, R.id.day_label_routine, R.id.day_value_routine, 1, theme.sleep },
            { R.id.day_dot_planned, R.id.day_label_planned, R.id.day_value_planned, 2, theme.primary },
            { R.id.day_dot_free, R.id.day_label_free, R.id.day_value_free, 0, theme.mutedForeground },
        };
        for (int[] s : stats) {
            v.setInt(s[0], "setColorFilter", s[4]);
            v.setTextColor(s[1], theme.mutedForeground);
            v.setTextViewText(s[2], totals == null ? "–" : duration(totals.optInt(s[3])));
            v.setTextColor(s[2], theme.foreground);
        }
        return v;
    }

    // ---- Schedule ----

    private static RemoteViews renderSchedule(Context context, int id, WidgetTheme theme, JSONObject day, boolean full) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_schedule);
        paintCard(v, theme, theme.card, theme.border);
        Intent strips = new Intent(context, StripService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        strips.setData(Uri.parse(strips.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.schedule_list, strips);
        v.setEmptyView(R.id.schedule_list, R.id.schedule_empty);
        v.setTextColor(R.id.schedule_empty, theme.mutedForeground);
        // Taps on the timeline open the app (a list needs a template; the rows fill in nothing).
        Intent launch = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setPendingIntentTemplate(R.id.schedule_list, PendingIntent.getActivity(context, 800003 + id, launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
        // Open at the current hour, like the app. Ticks leave the scroll where the user put it.
        if (full) v.setScrollPosition(R.id.schedule_list, Math.max(0, LocalTime.now().getHour()));
        return v;
    }

    // ---- Tasks and Habits ----

    private static RemoteViews renderList(Context context, int id, boolean tasks, WidgetTheme theme, JSONObject day) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_list);
        paintCard(v, theme, theme.card, theme.border);
        v.setTextViewText(R.id.list_heading, tasks ? "Tasks" : "Habits");
        v.setTextColor(R.id.list_heading, theme.foreground);
        v.setTextColor(R.id.list_count, theme.mutedForeground);
        v.setInt(R.id.list_add, "setColorFilter", theme.mutedForeground);
        v.setOnClickPendingIntent(R.id.list_header, openApp(context, 800010 + (tasks ? 0 : 1), null));
        v.setOnClickPendingIntent(R.id.list_add, openApp(context, 800020 + (tasks ? 0 : 1), tasks ? "add-task" : "add-habit"));

        JSONArray rows = day == null ? null : day.optJSONArray(tasks ? "tasks" : "habits");
        int total = rows == null ? 0 : rows.length(), done = 0;
        for (int i = 0; i < total; i++) {
            JSONObject r = rows.optJSONObject(i);
            if (tasks ? r.optBoolean("done") : r.optInt("mark") == 2) done++;
        }
        v.setTextViewText(R.id.list_count, total == 0 ? "" : tasks ? (total - done) + " left" : done + "/" + total);

        Intent adapter = new Intent(context, RowService.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra("tasks", tasks);
        adapter.setData(Uri.parse(adapter.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.list_rows, adapter);
        v.setEmptyView(R.id.list_rows, R.id.list_empty);
        v.setTextViewText(R.id.list_empty, day == null ? "Open Cadence to load your day"
            : tasks ? "No tasks. Add one in Cadence — it lands here if it has no time." : "No habits today.");
        v.setTextColor(R.id.list_empty, theme.mutedForeground);
        Intent tap = new Intent(context, ItemReceiver.class).setAction(ACTION_ITEM);
        v.setPendingIntentTemplate(R.id.list_rows, PendingIntent.getBroadcast(context, 800030 + (tasks ? 0 : 1), tap,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
        return v;
    }

    // ---- refresh timing ----

    /**
     * Wakes the widgets each minute while any exist (Right now's time left and the now line), and at
     * midnight. The alarm is inexact and doesn't wake the phone, so it costs nothing while the screen is off.
     */
    static void scheduleTick(Context context) {
        LocalDateTime next = LocalDateTime.now().withSecond(0).withNano(0).plusMinutes(1);
        long when = next.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() + 500;
        Intent tick = new Intent(context, TickReceiver.class).setAction(ACTION_TICK);
        context.getSystemService(AlarmManager.class).set(AlarmManager.RTC, when,
            PendingIntent.getBroadcast(context, 800100, tick, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }

    public static class TickReceiver extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String today = LocalDate.now().toString();
            boolean newDay = !today.equals(prefs.getString("lastDay", ""));
            // Switching the phone between light and dark redraws everything in the new colors.
            boolean dark = systemDark(context);
            boolean modeChanged = prefs.contains("lastDark") && prefs.getBoolean("lastDark", false) != dark;
            prefs.edit().putString("lastDay", today).putBoolean("lastDark", dark).apply();
            if (modeChanged) {
                refreshAll(context, true);
                return;
            }
            // Right now every minute; the rest every five minutes or when the day changes.
            if (newDay || LocalTime.now().getMinute() % 5 == 0 || !ACTION_TICK.equals(intent.getAction())) {
                refreshAll(context, newDay);
                return;
            }
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            for (int id : manager.getAppWidgetIds(new ComponentName(context, Now.class))) render(context, manager, Now.class, id, false);
            if (manager.getAppWidgetIds(new ComponentName(context, Schedule.class)).length > 0) {
                manager.notifyAppWidgetViewDataChanged(manager.getAppWidgetIds(new ComponentName(context, Schedule.class)), R.id.schedule_list);
            }
            scheduleTick(context);
        }
    }

    // ---- taps on tasks and habits ----

    /** Flips a task or cycles a habit in the snapshot, queues it for the app, and pokes the app if it's open. */
    public static class ItemReceiver extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            String op = intent.getStringExtra("op");
            int itemId = intent.getIntExtra("id", -1);
            String date = intent.getStringExtra("date");
            if (!"toggle".equals(op) && !"cycle".equals(op) || itemId < 0 || date == null) return;
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            try {
                JSONArray queue = new JSONArray(prefs.getString("actions", "[]"));
                queue.put(new JSONObject().put("op", op).put("id", itemId).put("date", date));
                JSONObject snapshot = snapshot(context);
                JSONObject day = today(snapshot);
                JSONArray rows = day == null ? null : day.optJSONArray("toggle".equals(op) ? "tasks" : "habits");
                for (int i = 0; rows != null && i < rows.length(); i++) {
                    JSONObject row = rows.getJSONObject(i);
                    if (row.optInt("id") != itemId) continue;
                    if ("toggle".equals(op) && date.equals(row.optString("occ"))) row.put("done", !row.optBoolean("done"));
                    if ("cycle".equals(op)) row.put("mark", (row.optInt("mark") + 1) % 3);
                }
                prefs.edit().putString("actions", queue.toString()).putString("snapshot", snapshot.toString()).apply();
            } catch (Exception ignored) {}
            refreshAll(context, false);
            MainActivity open = MainActivity.current();
            if (open != null) open.dispatchToPage("cadence-widget-actions");
        }
    }

    static String takeActions(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String actions = prefs.getString("actions", "[]");
        prefs.edit().remove("actions").apply();
        return actions;
    }

    // ---- list rows ----

    public static class RowService extends RemoteViewsService {
        @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
            return new RowFactory(getApplicationContext(), intent.getBooleanExtra("tasks", true));
        }
    }

    static final class RowFactory implements RemoteViewsService.RemoteViewsFactory {
        private final Context context;
        private final boolean tasks;
        private JSONArray rows = new JSONArray();
        private WidgetTheme theme = new WidgetTheme(null);

        RowFactory(Context context, boolean tasks) { this.context = context; this.tasks = tasks; }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() {
            JSONObject snapshot = snapshot(context);
            theme = theme(context, snapshot);
            JSONObject day = today(snapshot);
            JSONArray list = day == null ? null : day.optJSONArray(tasks ? "tasks" : "habits");
            rows = list == null ? new JSONArray() : list;
        }
        @Override public void onDestroy() {}
        @Override public int getCount() { return rows.length(); }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return rows.optJSONObject(position).optInt("id", position); }
        @Override public boolean hasStableIds() { return true; }

        @Override public RemoteViews getViewAt(int position) {
            JSONObject r = rows.optJSONObject(position);
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_row);
            String title = r.optString("title");
            if (tasks) {
                boolean done = r.optBoolean("done");
                // A tagged task's checkbox takes its tag's color, as in the app.
                String tagColor = r.optString("color");
                int box = tagColor.isEmpty() ? theme.task : WidgetDraw.parse(tagColor, theme.task);
                mark(v, done ? R.drawable.mark_box_done : R.drawable.mark_box, done, box, theme.card);
                SpannableStringBuilder t = new SpannableStringBuilder(title);
                if (done) t.setSpan(new StrikethroughSpan(), 0, t.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                v.setTextViewText(R.id.row_title, t);
                v.setTextColor(R.id.row_title, done ? theme.mutedForeground : theme.foreground);
                // Overdue · Due Sep 30 · High · 3 PM · Every day, colored as on the Today page
                SpannableStringBuilder sub = new SpannableStringBuilder();
                append(sub, r.optBoolean("overdue") ? "Overdue" : "", theme.destructive);
                append(sub, r.optString("due"), 0);
                append(sub, r.optBoolean("high") ? "High" : "", theme.task);
                append(sub, r.optString("time"), 0);
                append(sub, r.optString("rec"), 0);
                v.setTextViewText(R.id.row_sub, sub);
                v.setViewVisibility(R.id.row_sub, sub.length() == 0 ? View.GONE : View.VISIBLE);
                v.setViewVisibility(R.id.row_flame, View.GONE);
                v.setViewVisibility(R.id.row_streak, View.GONE);
                v.setContentDescription(R.id.row_mark, done ? "Mark " + title + " not done" : "Mark " + title + " done");
                v.setOnClickFillInIntent(R.id.row_mark, new Intent().putExtra("op", "toggle")
                    .putExtra("id", r.optInt("id")).putExtra("date", r.optString("occ")));
            } else {
                int mark = r.optInt("mark");
                mark(v, mark == 2 ? R.drawable.mark_circle_done : mark == 1 ? R.drawable.mark_circle_half : R.drawable.mark_circle,
                    mark == 2, theme.habit, theme.card);
                v.setTextViewText(R.id.row_title, title);
                v.setTextColor(R.id.row_title, mark == 2 ? theme.mutedForeground : theme.foreground);
                v.setTextViewText(R.id.row_sub, r.optString("sub"));
                v.setViewVisibility(R.id.row_sub, r.optString("sub").isEmpty() ? View.GONE : View.VISIBLE);
                int streak = r.optInt("streak");
                v.setViewVisibility(R.id.row_flame, streak > 0 ? View.VISIBLE : View.GONE);
                v.setViewVisibility(R.id.row_streak, streak > 0 ? View.VISIBLE : View.GONE);
                v.setInt(R.id.row_flame, "setColorFilter", theme.task);
                v.setTextViewText(R.id.row_streak, String.valueOf(streak));
                v.setTextColor(R.id.row_streak, theme.task);
                v.setContentDescription(R.id.row_mark, title + ": " + new String[] { "not done", "half done", "done" }[Math.max(0, Math.min(2, mark))]);
                v.setOnClickFillInIntent(R.id.row_mark, new Intent().putExtra("op", "cycle")
                    .putExtra("id", r.optInt("id")).putExtra("date", LocalDate.now().toString()));
            }
            v.setTextColor(R.id.row_sub, theme.mutedForeground);
            return v;
        }

        /** A checkbox or habit circle: the shape in the item's color, with the check in the card color when done. */
        private static void mark(RemoteViews v, int shape, boolean done, int color, int checkColor) {
            v.setImageViewResource(R.id.row_mark_shape, shape);
            v.setInt(R.id.row_mark_shape, "setColorFilter", color);
            v.setViewVisibility(R.id.row_mark_check, done ? View.VISIBLE : View.GONE);
            v.setInt(R.id.row_mark_check, "setColorFilter", checkColor);
        }

        private static void append(SpannableStringBuilder sub, String part, int color) {
            if (part == null || part.isEmpty()) return;
            if (sub.length() > 0) sub.append("  ");
            int start = sub.length();
            sub.append(part);
            if (color != 0) sub.setSpan(new ForegroundColorSpan(color), start, sub.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
    }

    // ---- schedule strips ----

    public static class StripService extends RemoteViewsService {
        @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
            return new StripFactory(getApplicationContext(),
                intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID));
        }
    }

    static final class StripFactory implements RemoteViewsService.RemoteViewsFactory {
        private final Context context;
        private final int widgetId;
        private JSONObject day;
        private WidgetTheme theme = new WidgetTheme(null);
        private int widthDp = 320, now = -1;

        StripFactory(Context context, int widgetId) { this.context = context; this.widgetId = widgetId; }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() {
            JSONObject snapshot = snapshot(context);
            theme = theme(context, snapshot);
            day = today(snapshot);
            widthDp = Math.max(160, widthDp(AppWidgetManager.getInstance(context), widgetId, 320) - 4);
            now = nowMinutes();
        }
        @Override public void onDestroy() {}
        @Override public int getCount() { return day == null ? 0 : 24; }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return true; }

        @Override public RemoteViews getViewAt(int hour) {
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_schedule_hour);
            v.setImageViewBitmap(R.id.hour_strip, WidgetDraw.hourStrip(context, hour, widthDp, day, theme, now));
            v.setOnClickFillInIntent(R.id.hour_strip, new Intent());
            return v;
        }
    }

    // ---- providers (one per widget in the picker) ----

    public abstract static class Base extends AppWidgetProvider {
        @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
            for (int id : ids) render(context, manager, getClass(), id, true);
            if (getClass() == Schedule.class) manager.notifyAppWidgetViewDataChanged(ids, R.id.schedule_list);
            if (getClass() == Tasks.class || getClass() == Habits.class) manager.notifyAppWidgetViewDataChanged(ids, R.id.list_rows);
            scheduleTick(context);
        }

        @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
            render(context, manager, getClass(), id, false);
            if (getClass() == Schedule.class) manager.notifyAppWidgetViewDataChanged(new int[] { id }, R.id.schedule_list);
        }

        @Override public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
                refreshAll(context, true);
                return;
            }
            super.onReceive(context, intent);
        }
    }

    public static class Now extends Base {}
    public static class Day extends Base {}
    public static class Schedule extends Base {}
    public static class Tasks extends Base {}
    public static class Habits extends Base {}
}
