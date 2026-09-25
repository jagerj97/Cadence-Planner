package app.cadence.planner;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.text.SpannableString;
import android.text.Spanned;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Home screen widget showing the Today page. The web app saves a week-long snapshot through the
 * bridge (widget.ts); this picks today's part and works out "Right now" from the clock, so it keeps
 * up while the app is closed. Each widget remembers which panels it shows.
 */
public class CadenceWidget extends AppWidgetProvider {
    static final String PREFS = "cadence_widget";
    static final String ACTION_TICK = "app.cadence.planner.WIDGET_TICK";
    static final String[] PANELS = { "now", "day", "schedule", "tasks", "habits" };
    static final String[] PANEL_LABELS = { "Right now", "Your day", "Schedule", "Tasks", "Habits" };

    /** Saves a new snapshot from the app and redraws every widget. */
    static void saveSnapshot(Context context, String json) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("snapshot", json).apply();
        refreshAll(context);
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, CadenceWidget.class));
        if (ids.length == 0) return;
        for (int id : ids) render(context, manager, id);
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        scheduleTick(context);
    }

    static boolean shows(Context context, int widgetId, String panel) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(widgetId + ":" + panel, true);
    }

    static void setShows(Context context, int widgetId, String panel, boolean shown) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(widgetId + ":" + panel, shown).apply();
    }

    static JSONObject today(Context context) {
        try {
            JSONObject snapshot = new JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("snapshot", "{}"));
            return snapshot.optJSONObject("days") == null ? null : snapshot.getJSONObject("days").optJSONObject(LocalDate.now().toString());
        } catch (Exception e) {
            return null;
        }
    }

    static int accent(Context context) {
        try {
            JSONObject snapshot = new JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("snapshot", "{}"));
            return Color.parseColor(snapshot.optString("accent", "#E66B0A"));
        } catch (Exception e) {
            return Color.rgb(230, 107, 10);
        }
    }

    private static PendingIntent openApp(Context context, int code, int flags) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) launch = new Intent(context, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return PendingIntent.getActivity(context, code, launch, flags);
    }

    static void render(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        JSONObject day = today(context);
        views.setTextViewText(R.id.widget_date, day == null ? "" : day.optString("label", ""));
        views.setTextColor(R.id.widget_title, accent(context));

        Intent rows = new Intent(context, RowsService.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        rows.setData(Uri.parse(rows.toUri(Intent.URI_INTENT_SCHEME))); // one adapter per widget
        views.setRemoteAdapter(R.id.widget_list, rows);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);
        views.setTextViewText(R.id.widget_empty, day == null ? "Open Cadence to load your day"
            : "All panels are hidden. Tap the gear to choose some.");

        views.setOnClickPendingIntent(R.id.widget_header, openApp(context, 700000 + widgetId,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        // Rows fill in nothing, so the template just opens the app; it must be mutable to accept fill-ins.
        views.setPendingIntentTemplate(R.id.widget_list, openApp(context, 710000 + widgetId,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
        Intent configure = new Intent(context, WidgetConfigActivity.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
            .setData(Uri.parse("cadence-widget://configure/" + widgetId));
        views.setOnClickPendingIntent(R.id.widget_settings, PendingIntent.getActivity(context, 720000 + widgetId, configure,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        manager.updateAppWidget(widgetId, views);
    }

    /** Redraw when "Right now" next changes (an item starts or ends), at midnight, and at least every 15 minutes. */
    static void scheduleTick(Context context) {
        LocalDateTime now = LocalDateTime.now();
        int nowMin = now.getHour() * 60 + now.getMinute();
        int next = Math.min(1440, nowMin + 15);
        JSONObject day = today(context);
        JSONArray blocks = day == null ? null : day.optJSONArray("blocks");
        for (int i = 0; blocks != null && i < blocks.length(); i++) {
            JSONObject b = blocks.optJSONObject(i);
            if (b == null) continue;
            for (int edge : new int[] { b.optInt("start"), b.optInt("end") }) if (edge > nowMin && edge < next) next = edge;
        }
        LocalDateTime at = next >= 1440 ? now.toLocalDate().plusDays(1).atStartOfDay()
            : now.toLocalDate().atTime(LocalTime.of(next / 60, next % 60));
        long when = at.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() + 1000;
        Intent tick = new Intent(context, CadenceWidget.class).setAction(ACTION_TICK);
        context.getSystemService(AlarmManager.class).set(AlarmManager.RTC, when,
            PendingIntent.getBroadcast(context, 730000, tick, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }

    @Override public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (ACTION_TICK.equals(action) || Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            refreshAll(context);
            return;
        }
        super.onReceive(context, intent);
    }

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(context, manager, id);
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        scheduleTick(context);
    }

    @Override public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        for (int id : ids) for (String panel : PANELS) prefs.remove(id + ":" + panel);
        prefs.apply();
    }

    // ---- rows ----

    static String time(int minutes) {
        int m = ((minutes % 1440) + 1440) % 1440, h = m / 60, r = m % 60;
        String suffix = h < 12 ? "am" : "pm";
        int h12 = h % 12 == 0 ? 12 : h % 12;
        return r == 0 ? h12 + suffix : String.format(Locale.US, "%d:%02d%s", h12, r, suffix);
    }

    static String duration(int minutes) {
        int m = Math.max(0, minutes), h = m / 60, r = m % 60;
        return h == 0 ? r + "m" : r == 0 ? h + "h" : h + "h " + r + "m";
    }

    private static int color(String hex, int fallback) {
        try { return Color.parseColor(hex); } catch (Exception e) { return fallback; }
    }

    /** One line of the widget: a section header, an item, or a plain message. */
    static final class Row {
        final int layout;
        String title = "", sub = "", right = "", mark = "";
        int color = Color.GRAY;
        boolean done, muted;
        Row(int layout) { this.layout = layout; }
        static Row section(String title, String right) { Row r = new Row(R.layout.widget_section); r.title = title; r.right = right; return r; }
        static Row message(String text) { Row r = new Row(R.layout.widget_message); r.title = text; return r; }
        static Row item(String title, String sub, int color) { Row r = new Row(R.layout.widget_item); r.title = title; r.sub = sub; r.color = color; return r; }
    }

    static List<Row> rows(Context context, int widgetId) {
        List<Row> out = new ArrayList<>();
        JSONObject day = today(context);
        if (day == null) return out;
        LocalTime clock = LocalTime.now();
        int now = clock.getHour() * 60 + clock.getMinute();
        int fallback = accent(context);
        JSONArray blocks = day.optJSONArray("blocks");
        if (blocks == null) blocks = new JSONArray();

        if (shows(context, widgetId, "now")) {
            out.add(Row.section("Right now", time(now)));
            JSONObject current = null, next = null;
            for (int i = 0; i < blocks.length(); i++) {
                JSONObject b = blocks.optJSONObject(i);
                if (b == null) continue;
                if (current == null && now >= b.optInt("start") && now < b.optInt("end")) current = b;
                if (next == null && b.optInt("start") > now && b.optBoolean("startsToday", true)) next = b;
            }
            if (current != null) {
                int end = current.optInt("fullEnd", current.optInt("end"));
                out.add(Row.item(current.optString("title"), duration(end - now) + " left · ends " + time(end),
                    color(current.optString("color"), fallback)));
            } else out.add(Row.message("Nothing scheduled right now"));
            if (next != null) {
                Row r = Row.item("Next: " + next.optString("title"), time(next.optInt("start")) + " · in " + duration(next.optInt("start") - now),
                    color(next.optString("color"), fallback));
                out.add(r);
            }
        }

        if (shows(context, widgetId, "day")) {
            JSONArray totals = day.optJSONArray("totals");
            out.add(Row.section("Your day", ""));
            if (totals != null && totals.length() == 3) {
                out.add(Row.message("Routines " + duration(totals.optInt(1)) + " · Planned " + duration(totals.optInt(2))
                    + " · Free " + duration(totals.optInt(0))));
            }
        }

        if (shows(context, widgetId, "schedule")) {
            JSONArray allDay = day.optJSONArray("allDay");
            int count = blocks.length() + (allDay == null ? 0 : allDay.length());
            out.add(Row.section("Schedule", count == 0 ? "" : String.valueOf(count)));
            for (int i = 0; allDay != null && i < allDay.length(); i++) {
                JSONObject a = allDay.optJSONObject(i);
                if (a != null) out.add(Row.item(a.optString("title"), "All day", color(a.optString("color"), fallback)));
            }
            for (int i = 0; i < blocks.length(); i++) {
                JSONObject b = blocks.optJSONObject(i);
                if (b == null) continue;
                int start = b.optInt("start"), end = b.optInt("fullEnd", b.optInt("end"));
                String when = b.optBoolean("startsToday", true) ? time(start) + "–" + time(end) : "Until " + time(end);
                Row r = Row.item(b.optString("title"), when, color(b.optString("color"), fallback));
                r.muted = b.optInt("end") <= now;
                out.add(r);
            }
            if (count == 0) out.add(Row.message("Nothing scheduled"));
        }

        if (shows(context, widgetId, "tasks")) {
            JSONArray tasks = day.optJSONArray("tasks");
            int left = 0;
            for (int i = 0; tasks != null && i < tasks.length(); i++) if (!tasks.optJSONObject(i).optBoolean("done")) left++;
            out.add(Row.section("Tasks", tasks == null || tasks.length() == 0 ? "" : left + " left"));
            for (int i = 0; tasks != null && i < tasks.length(); i++) {
                JSONObject t = tasks.optJSONObject(i);
                Row r = Row.item(t.optString("title"), t.optString("sub"), color(t.optString("color"), fallback));
                r.done = t.optBoolean("done");
                r.mark = r.done ? "☑" : "☐";
                out.add(r);
            }
            if (tasks == null || tasks.length() == 0) out.add(Row.message("No tasks"));
        }

        if (shows(context, widgetId, "habits")) {
            JSONArray habits = day.optJSONArray("habits");
            int done = 0;
            for (int i = 0; habits != null && i < habits.length(); i++) if (habits.optJSONObject(i).optInt("mark") == 2) done++;
            out.add(Row.section("Habits", habits == null || habits.length() == 0 ? "" : done + "/" + habits.length()));
            for (int i = 0; habits != null && i < habits.length(); i++) {
                JSONObject h = habits.optJSONObject(i);
                Row r = Row.item(h.optString("title"), h.optString("sub"), color(h.optString("color"), fallback));
                int mark = h.optInt("mark");
                r.mark = mark == 2 ? "●" : mark == 1 ? "◐" : "○";
                r.muted = mark == 2;
                int streak = h.optInt("streak");
                if (streak > 0) r.right = "🔥 " + streak;
                out.add(r);
            }
            if (habits == null || habits.length() == 0) out.add(Row.message("No habits today"));
        }
        return out;
    }

    public static class RowsService extends RemoteViewsService {
        @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
            return new Factory(getApplicationContext(),
                intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID));
        }
    }

    static final class Factory implements RemoteViewsService.RemoteViewsFactory {
        private final Context context;
        private final int widgetId;
        private List<Row> rows = new ArrayList<>();

        Factory(Context context, int widgetId) { this.context = context; this.widgetId = widgetId; }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() { rows = CadenceWidget.rows(context, widgetId); }
        @Override public void onDestroy() {}
        @Override public int getCount() { return rows.size(); }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 3; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }

        @Override public RemoteViews getViewAt(int position) {
            Row row = rows.get(position);
            RemoteViews views = new RemoteViews(context.getPackageName(), row.layout);
            if (row.layout == R.layout.widget_section) {
                views.setTextViewText(R.id.section_title, row.title);
                views.setTextViewText(R.id.section_right, row.right);
            } else if (row.layout == R.layout.widget_message) {
                views.setTextViewText(R.id.row_root, row.title);
            } else {
                CharSequence title = row.title;
                if (row.done) {
                    SpannableString struck = new SpannableString(row.title);
                    struck.setSpan(new StrikethroughSpan(), 0, struck.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    title = struck;
                }
                views.setTextViewText(R.id.item_title, title);
                views.setTextColor(R.id.item_title, context.getColor(row.done || row.muted ? R.color.widget_muted : R.color.widget_text));
                views.setTextViewText(R.id.item_sub, row.sub);
                views.setViewVisibility(R.id.item_sub, row.sub.isEmpty() ? View.GONE : View.VISIBLE);
                views.setTextViewText(R.id.item_right, row.right);
                if (row.mark.isEmpty()) {
                    views.setViewVisibility(R.id.item_mark, View.GONE);
                    views.setViewVisibility(R.id.item_dot, View.VISIBLE);
                    views.setInt(R.id.item_dot, "setColorFilter", row.color);
                } else {
                    views.setViewVisibility(R.id.item_mark, View.VISIBLE);
                    views.setViewVisibility(R.id.item_dot, View.GONE);
                    views.setTextViewText(R.id.item_mark, row.mark);
                    views.setTextColor(R.id.item_mark, row.color);
                }
            }
            views.setOnClickFillInIntent(R.id.row_root, new Intent());
            return views;
        }
    }
}
