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
 * One home screen widget per Today card: Right now, Your day, Timeline, Agenda, Tasks, and Habits. The web
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

    static final Class<?>[] PROVIDERS = { Now.class, Day.class, Schedule.class, Agenda.class, Tasks.class, Habits.class, Journal.class };

    /**
     * Redraws every widget from one reading of the snapshot. `lists` also reloads the list widgets'
     * rows (for new data); without it only the timeline's are, for its now line.
     */
    static void refreshAll(Context context, boolean lists) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        JSONObject snapshot = snapshot(context);
        boolean any = false;
        for (Class<?> provider : PROVIDERS) {
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, provider));
            if (ids.length == 0) continue;
            any = true;
            for (int id : ids) render(context, manager, provider, id, snapshot);
            int list = listId(provider);
            if (list != 0 && (lists || provider == Schedule.class)) manager.notifyAppWidgetViewDataChanged(ids, list);
        }
        if (any) scheduleTick(context);
    }

    /** The scrolling list in a widget, or 0 for widgets without one. */
    static int listId(Class<?> provider) {
        if (provider == Schedule.class) return R.id.schedule_list;
        if (provider == Agenda.class) return R.id.agenda_list;
        if (provider == Journal.class) return R.id.journal_list;
        if (provider == Tasks.class || provider == Habits.class) return R.id.list_rows;
        return 0;
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

    /** The card in the theme's card color, washed from the top left corner with the widget's color. */
    private static void paintCard(RemoteViews views, WidgetTheme theme, int color) {
        views.setInt(R.id.card_bg, "setColorFilter", theme.card);
        views.setInt(R.id.card_tint, "setColorFilter", color);
        views.setInt(R.id.card_tint, "setImageAlpha", Math.round((theme.dark ? 0.16f : 0.22f) * 255));
    }

    /** The app, brought back as it is, opening a page ("open:/tasks") or adding something ("add-task"). */
    private static Intent launch(Context context, String add, String tag) {
        return new Intent(context, AppActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_ADD, add).setData(Uri.parse("cadence-widget://" + tag));
    }

    /** Opens the app at a page ("open:/tasks") or to add something ("add-task"). */
    private static PendingIntent openApp(Context context, int code, String add) {
        return PendingIntent.getActivity(context, code, launch(context, add, "add/" + add),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * A list's rows from its service, one adapter per widget (the id in the data keeps them apart).
     * Taps on the rows open `page`; every widget of a kind shares that, so it has one fixed code.
     */
    private static void list(Context context, RemoteViews v, int list, Intent adapter, int id, int code, String page, String tag) {
        adapter.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        adapter.setData(Uri.parse(adapter.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(list, adapter);
        if (page != null) v.setPendingIntentTemplate(list, PendingIntent.getActivity(context, code, launch(context, page, "open/" + tag),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
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

    static void render(Context context, AppWidgetManager manager, Class<?> provider, int id, JSONObject snapshot) {
        WidgetTheme theme = theme(context, snapshot);
        JSONObject day = today(snapshot);
        RemoteViews views;
        if (provider == Now.class) views = renderNow(context, manager, id, theme, day);
        else if (provider == Day.class) views = renderDay(context, manager, id, theme, day);
        else if (provider == Schedule.class) views = renderSchedule(context, id, theme, day);
        else if (provider == Agenda.class) views = renderAgenda(context, id, theme, snapshot);
        else if (provider == Journal.class) views = renderJournal(context, id, theme, snapshot);
        else views = renderList(context, id, provider == Tasks.class, theme, day);
        manager.updateAppWidget(id, views);
    }

    // ---- Right now ----

    private static RemoteViews renderNow(Context context, AppWidgetManager manager, int id, WidgetTheme theme, JSONObject day) {
        int now = nowMinutes();
        JSONObject current = null, next = null;
        JSONArray blocks = day == null ? null : day.optJSONArray("blocks");
        for (int i = 0; blocks != null && i < blocks.length(); i++) {
            JSONObject b = blocks.optJSONObject(i);
            // Tasks that are already checked off don't need doing now.
            if (b == null || b.optBoolean("done") && "task".equals(b.optString("kind"))) continue;
            // A task is due at its time, so it can be next but isn't "right now".
            if (current == null && now >= b.optInt("start") && now < b.optInt("end") && !"task".equals(b.optString("kind"))) current = b;
            String continues = b.optString("continues");
            if (next == null && b.optInt("start") > now && !"before".equals(continues)) next = b;
        }
        // With nothing else on, a routine from Settings is named (no ring, and it's never "next").
        JSONObject routine = null;
        JSONArray routines = day == null ? null : day.optJSONArray("routines");
        for (int i = 0; routines != null && i < routines.length() && routine == null; i++) {
            JSONObject r = routines.optJSONObject(i);
            if (r != null && now >= r.optInt("start") && now < r.optInt("end")) routine = r;
        }
        int color = current != null ? WidgetDraw.parse(current.optString("color"), theme.primary) : theme.primary;
        int start = current == null ? 0 : current.optInt("fullStart", current.optInt("start"));
        int end = current == null ? 0 : current.optInt("fullEnd", current.optInt("end"));

        // One column wide: the ring above the title. A row tall: no heading or "next".
        int width = widthDp(manager, id, 300), height = heightDp(manager, id);
        if (width < 150) {
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_now_small);
            paintCard(v, theme, color);
            v.setOnClickPendingIntent(R.id.card_root, openApp(context, 800001, "open:/"));
            boolean roomy = height == 0 || height >= 100;
            if (current != null) {
                v.setViewVisibility(R.id.now_ring, View.VISIBLE);
                v.setImageViewBitmap(R.id.now_ring, WidgetDraw.ring(context, (now - start) / (float) Math.max(1, end - start),
                    color, theme.border, current.optString("kind")));
                v.setTextViewText(R.id.now_title, current.optString("title"));
                v.setTextViewText(R.id.now_sub, duration(end - now) + " left");
            } else {
                v.setViewVisibility(R.id.now_ring, View.GONE);
                v.setTextViewText(R.id.now_title, day == null ? "Open Cadence" : routine != null ? routine.optString("title")
                    : next != null ? next.optString("title") : "Nothing now");
                v.setTextViewText(R.id.now_sub, routine != null ? "Routine now" : next != null ? "Next · " + time(next.optInt("start")) : "");
            }
            v.setViewVisibility(R.id.now_title, roomy || current == null ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.now_sub, roomy ? View.VISIBLE : View.GONE);
            v.setTextColor(R.id.now_title, theme.foreground);
            v.setTextColor(R.id.now_sub, theme.mutedForeground);
            return v;
        }

        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_now);
        paintCard(v, theme, color);
        v.setTextColor(R.id.now_heading, theme.foreground);
        v.setOnClickPendingIntent(R.id.card_root, openApp(context, 800001, "open:/"));
        boolean tall = height == 0 || height >= 100;
        v.setViewVisibility(R.id.now_header, tall ? View.VISIBLE : View.GONE);
        int pad = Math.round((tall ? 16 : 12) * context.getResources().getDisplayMetrics().density);
        v.setViewPadding(R.id.now_body, pad, pad, pad, pad);
        if (current != null) {
            v.setViewVisibility(R.id.now_current, View.VISIBLE);
            v.setViewVisibility(R.id.now_ring, View.VISIBLE);
            v.setViewVisibility(R.id.now_empty, View.GONE);
            v.setImageViewBitmap(R.id.now_ring, WidgetDraw.ring(context, (now - start) / (float) Math.max(1, end - start),
                color, theme.border, current.optString("kind")));
            v.setTextViewText(R.id.now_title, current.optString("title"));
            v.setTextColor(R.id.now_title, theme.foreground);
            v.setTextViewText(R.id.now_sub, duration(end - now) + " left · ends " + time(end));
            v.setTextColor(R.id.now_sub, theme.mutedForeground);
        } else if (routine != null) {
            v.setViewVisibility(R.id.now_current, View.GONE);
            v.setViewVisibility(R.id.now_empty, View.VISIBLE);
            v.setTextColor(R.id.now_empty, theme.mutedForeground);
            v.setTextViewText(R.id.now_empty, "Looks like you've got a routine now — " + routine.optString("title"));
        } else if (!tall && next != null) {
            // A row tall with nothing on: what's next, in the current item's place.
            v.setViewVisibility(R.id.now_current, View.VISIBLE);
            v.setViewVisibility(R.id.now_empty, View.GONE);
            v.setViewVisibility(R.id.now_ring, View.GONE);
            v.setTextViewText(R.id.now_title, next.optString("title"));
            v.setTextColor(R.id.now_title, theme.foreground);
            v.setTextViewText(R.id.now_sub, "Next · " + time(next.optInt("start")) + " · in " + duration(next.optInt("start") - now));
            v.setTextColor(R.id.now_sub, theme.mutedForeground);
        } else {
            v.setViewVisibility(R.id.now_current, View.GONE);
            v.setViewVisibility(R.id.now_empty, View.VISIBLE);
            v.setTextColor(R.id.now_empty, theme.mutedForeground);
            v.setTextViewText(R.id.now_empty, day == null ? "Open Cadence to load your day" : tasksLeft(day)
                ? "Nothing's happening right now... Maybe there's time for a task!" : "Looks like you've got some free time!");
        }
        int nextVisibility = next == null || !tall ? View.GONE : View.VISIBLE;
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

    /** Whether any of the day's tasks are still to do. */
    private static boolean tasksLeft(JSONObject day) {
        JSONArray tasks = day.optJSONArray("tasks");
        for (int i = 0; tasks != null && i < tasks.length(); i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t != null && !t.optBoolean("done")) return true;
        }
        return false;
    }

    // ---- Your day ----

    private static RemoteViews renderDay(Context context, AppWidgetManager manager, int id, WidgetTheme theme, JSONObject day) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_day);
        paintCard(v, theme, theme.primary);
        v.setOnClickPendingIntent(R.id.card_root, openApp(context, 800002, "open:/"));
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

    private static RemoteViews renderSchedule(Context context, int id, WidgetTheme theme, JSONObject day) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_schedule);
        paintCard(v, theme, theme.primary);
        v.setOnClickPendingIntent(R.id.card_root, openApp(context, 800005, "open:/"));
        // Taps on the timeline open Today (a list needs a template; the rows fill in nothing).
        list(context, v, R.id.schedule_list, new Intent(context, StripService.class), id, 800060, "open:/", "today");
        v.setEmptyView(R.id.schedule_list, R.id.schedule_empty);
        v.setTextColor(R.id.schedule_empty, theme.mutedForeground);
        // Open at the current hour, like the app: once when it's placed and once a day. Changes saved
        // from the app and ticks leave the scroll where the user put it, so it never jumps mid-scroll.
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String today = LocalDate.now().toString(), key = "scrolledDay" + id;
        if (!today.equals(prefs.getString(key, ""))) {
            v.setScrollPosition(R.id.schedule_list, Math.max(0, LocalTime.now().getHour()));
            prefs.edit().putString(key, today).apply();
        }
        return v;
    }

    // ---- Journal ----

    /** Today's entries, or a note that there are none yet and the latest two. Tapping it opens the journal. */
    private static RemoteViews renderJournal(Context context, int id, WidgetTheme theme, JSONObject snapshot) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_journal);
        paintCard(v, theme, theme.primary);
        v.setOnClickPendingIntent(R.id.card_root, openApp(context, 800050, "open:/journal"));
        v.setTextColor(R.id.journal_heading, theme.foreground);
        int count = JournalFactory.todays(snapshot.optJSONArray("journal"), LocalDate.now().toString()).size();
        v.setTextViewText(R.id.journal_count, count == 0 ? "" : count + " today");
        v.setTextColor(R.id.journal_count, theme.mutedForeground);
        v.setInt(R.id.journal_add, "setColorFilter", theme.mutedForeground);
        v.setOnClickPendingIntent(R.id.journal_add, openApp(context, 800052, "add-journal"));
        list(context, v, R.id.journal_list, new Intent(context, JournalService.class), id, 800062, "open:/journal", "journal-list");
        return v;
    }

    // ---- Agenda ----

    private static RemoteViews renderAgenda(Context context, int id, WidgetTheme theme, JSONObject snapshot) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_agenda);
        paintCard(v, theme, theme.primary);
        v.setOnClickPendingIntent(R.id.card_root, openApp(context, 800043, "open:/"));
        v.setTextColor(R.id.agenda_heading, theme.foreground);
        v.setInt(R.id.agenda_add, "setColorFilter", theme.mutedForeground);
        v.setOnClickPendingIntent(R.id.agenda_add, openApp(context, 800041, "add-event"));
        // Tapping the list opens Today.
        list(context, v, R.id.agenda_list, new Intent(context, AgendaService.class), id, 800061, "open:/", "agenda-today");
        v.setEmptyView(R.id.agenda_list, R.id.agenda_empty);
        v.setTextColor(R.id.agenda_empty, theme.mutedForeground);
        return v;
    }

    // ---- Tasks and Habits ----

    private static RemoteViews renderList(Context context, int id, boolean tasks, WidgetTheme theme, JSONObject day) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_list);
        paintCard(v, theme, tasks ? theme.task : theme.habit);
        v.setOnClickPendingIntent(R.id.card_root, openApp(context, 800012 + (tasks ? 0 : 1), tasks ? "open:/tasks" : "open:/habits"));
        v.setTextViewText(R.id.list_heading, tasks ? "Tasks" : "Habits");
        v.setTextColor(R.id.list_heading, theme.foreground);
        v.setTextColor(R.id.list_count, theme.mutedForeground);
        v.setInt(R.id.list_add, "setColorFilter", theme.mutedForeground);
        v.setOnClickPendingIntent(R.id.list_add, openApp(context, 800020 + (tasks ? 0 : 1), tasks ? "add-task" : "add-habit"));

        JSONArray rows = day == null ? null : day.optJSONArray(tasks ? "tasks" : "habits");
        int total = rows == null ? 0 : rows.length(), done = 0;
        for (int i = 0; i < total; i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r != null && (tasks ? r.optBoolean("done") : r.optInt("mark") == 2)) done++;
        }
        v.setTextViewText(R.id.list_count, total == 0 ? "" : tasks ? (total - done) + " left" : done + "/" + total);

        // Rows tap through to ItemReceiver (to tick them off) rather than opening the app.
        list(context, v, R.id.list_rows, new Intent(context, RowService.class).putExtra("tasks", tasks), id, 0, null, null);
        v.setEmptyView(R.id.list_rows, R.id.list_empty);
        v.setTextViewText(R.id.list_empty, day == null ? "Open Cadence to load your day"
            : tasks ? "No tasks today" : "No habits today");
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
            // The lists' rows only change with the day (the agenda and journal move on at midnight).
            if (newDay || LocalTime.now().getMinute() % 5 == 0) {
                refreshAll(context, newDay);
                return;
            }
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] now = manager.getAppWidgetIds(new ComponentName(context, Now.class));
            if (now.length > 0) {
                JSONObject snapshot = snapshot(context);
                for (int id : now) render(context, manager, Now.class, id, snapshot);
            }
            int[] schedule = manager.getAppWidgetIds(new ComponentName(context, Schedule.class));
            if (schedule.length > 0) manager.notifyAppWidgetViewDataChanged(schedule, R.id.schedule_list);
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
                // A timed task is on the timeline and agenda too, so it's checked off there as well.
                if ("toggle".equals(op)) {
                    if (day != null) flip(day.optJSONArray("blocks"), itemId, date);
                    JSONArray agenda = snapshot.optJSONArray("agenda");
                    for (int d = 0; agenda != null && d < agenda.length(); d++) {
                        JSONObject a = agenda.optJSONObject(d);
                        if (a != null) flip(a.optJSONArray("entries"), itemId, date);
                    }
                }
                prefs.edit().putString("actions", queue.toString()).putString("snapshot", snapshot.toString()).apply();
            } catch (Exception ignored) {}
            refreshAll(context, true);
            AppActivity open = AppActivity.current();
            if (open != null) open.dispatchToPage("cadence-widget-actions");
        }
    }

    /** Flips `done` on the entries for one occurrence of an item. */
    private static void flip(JSONArray entries, int id, String occ) throws org.json.JSONException {
        for (int i = 0; entries != null && i < entries.length(); i++) {
            JSONObject e = entries.optJSONObject(i);
            if (e != null && e.optInt("id", -1) == id && occ.equals(e.optString("occ"))) e.put("done", !e.optBoolean("done"));
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
        @Override public long getItemId(int position) {
            JSONObject r = rows.optJSONObject(position);
            return r == null ? position : r.optInt("id", position);
        }
        @Override public boolean hasStableIds() { return true; }

        @Override public RemoteViews getViewAt(int position) {
            JSONObject r = rows.optJSONObject(position);
            if (r == null) r = new JSONObject();
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
                // A streak below zero is the days in a row it's been missed, in grey.
                v.setViewVisibility(R.id.row_flame, streak != 0 ? View.VISIBLE : View.GONE);
                v.setViewVisibility(R.id.row_streak, streak != 0 ? View.VISIBLE : View.GONE);
                v.setInt(R.id.row_flame, "setColorFilter", streak < 0 ? theme.mutedForeground : theme.task);
                v.setTextViewText(R.id.row_streak, streak < 0 ? "\u2212" + (-streak) : String.valueOf(streak));
                v.setTextColor(R.id.row_streak, streak < 0 ? theme.mutedForeground : theme.task);
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

    // ---- agenda rows ----

    public static class AgendaService extends RemoteViewsService {
        @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
            return new AgendaFactory(getApplicationContext());
        }
    }

    /**
     * The snapshot's two weeks as rows: each day's date ("Today", "Thu, Oct 8"), then its items. Days
     * already past (the snapshot may be a few days old) are left out, and an empty today says
     * "Nothing planned".
     */
    static final class AgendaFactory implements RemoteViewsService.RemoteViewsFactory {
        private final Context context;
        /** Each row: {"date": "2026-10-08"} for a day's heading, or {"entry": {...}} (null entry: nothing planned). */
        private final java.util.ArrayList<JSONObject> rows = new java.util.ArrayList<>();
        private WidgetTheme theme = new WidgetTheme(null);
        private String today = "";

        AgendaFactory(Context context) { this.context = context; }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() {
            JSONObject snapshot = snapshot(context);
            theme = theme(context, snapshot);
            today = LocalDate.now().toString();
            rows.clear();
            JSONArray days = snapshot.optJSONArray("agenda");
            if (days == null) return;
            boolean todayListed = false;
            try {
                for (int d = 0; d < days.length(); d++) {
                    JSONObject day = days.optJSONObject(d);
                    String date = day == null ? "" : day.optString("day");
                    if (date.compareTo(today) < 0) continue;
                    JSONArray entries = day.optJSONArray("entries");
                    boolean isToday = today.equals(date);
                    if ((entries == null || entries.length() == 0) && !isToday) continue;
                    // A snapshot from before today began still starts with today, empty.
                    if (!todayListed && !isToday) { rows.add(new JSONObject().put("date", today)); rows.add(new JSONObject()); }
                    todayListed = true;
                    rows.add(new JSONObject().put("date", date));
                    if (entries == null || entries.length() == 0) rows.add(new JSONObject());
                    for (int e = 0; entries != null && e < entries.length(); e++) rows.add(new JSONObject().put("entry", entries.optJSONObject(e)));
                }
                if (!todayListed) { rows.add(new JSONObject().put("date", today)); rows.add(new JSONObject()); }
            } catch (Exception ignored) {}
        }
        @Override public void onDestroy() {}
        @Override public int getCount() { return rows.size(); }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 2; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }

        @Override public RemoteViews getViewAt(int position) {
            JSONObject r = position < rows.size() ? rows.get(position) : new JSONObject();
            if (r.has("date")) {
                String date = r.optString("date");
                RemoteViews h = new RemoteViews(context.getPackageName(), R.layout.widget_agenda_day);
                h.setTextViewText(R.id.agenda_day, dayLabel(date));
                h.setTextColor(R.id.agenda_day, today.equals(date) ? theme.primary : theme.mutedForeground);
                h.setOnClickFillInIntent(R.id.agenda_day, new Intent());
                return h;
            }
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_agenda_row);
            JSONObject entry = r.optJSONObject("entry");
            if (entry == null) {
                v.setViewVisibility(R.id.agenda_item, View.GONE);
                v.setViewVisibility(R.id.agenda_nothing, View.VISIBLE);
                v.setTextColor(R.id.agenda_nothing, theme.mutedForeground);
            } else {
                v.setViewVisibility(R.id.agenda_nothing, View.GONE);
                v.setViewVisibility(R.id.agenda_item, View.VISIBLE);
                String kind = entry.optString("kind");
                int color = WidgetDraw.parse(entry.optString("color"), theme.primary);
                String accentHex = entry.optString("accent");
                int accent = accentHex.isEmpty() ? color : WidgetDraw.parse(accentHex, color);
                boolean done = entry.optBoolean("done");
                // A tint of the item's color over the card, as the app draws it (15%, 10% for sleep).
                v.setInt(R.id.agenda_item_bg, "setColorFilter", mix(color, theme.card, "sleep".equals(kind) ? 0.10f : 0.15f));
                v.setInt(R.id.agenda_item_edge, "setColorFilter", accent);
                v.setImageViewResource(R.id.agenda_icon, WidgetDraw.kindIcon(kind));
                v.setInt(R.id.agenda_icon, "setColorFilter", color);
                String title = entry.optString("title");
                SpannableStringBuilder t = new SpannableStringBuilder(title);
                if (done) t.setSpan(new StrikethroughSpan(), 0, t.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                v.setTextViewText(R.id.agenda_title, t);
                v.setTextColor(R.id.agenda_title, done ? theme.mutedForeground : theme.foreground);
                String sub = entry.optString("sub");
                v.setTextViewText(R.id.agenda_sub, sub);
                v.setViewVisibility(R.id.agenda_sub, sub.isEmpty() ? View.GONE : View.VISIBLE);
                v.setTextColor(R.id.agenda_sub, theme.mutedForeground);
            }
            v.setOnClickFillInIntent(R.id.agenda_row, new Intent());
            return v;
        }

        /** "Today", "Tomorrow", or "Thu, Oct 8". */
        private String dayLabel(String date) {
            try {
                LocalDate d = LocalDate.parse(date), now = LocalDate.now();
                if (d.equals(now)) return "Today";
                if (d.equals(now.plusDays(1))) return "Tomorrow";
                return d.getDayOfWeek().getDisplayName(java.time.format.TextStyle.SHORT, Locale.US) + ", "
                    + d.getMonth().getDisplayName(java.time.format.TextStyle.SHORT, Locale.US) + " " + d.getDayOfMonth();
            } catch (Exception e) {
                return date;
            }
        }
    }

    // ---- journal rows ----

    public static class JournalService extends RemoteViewsService {
        @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
            return new JournalFactory(getApplicationContext());
        }
    }

    /**
     * The snapshot's latest entries: today's, or (with none today, or a snapshot from an earlier day)
     * a note saying so and the latest two.
     */
    static final class JournalFactory implements RemoteViewsService.RemoteViewsFactory {
        private final Context context;
        /** Each row: an entry, or null for the note. */
        private final java.util.ArrayList<JSONObject> rows = new java.util.ArrayList<>();
        private WidgetTheme theme = new WidgetTheme(null);
        private boolean today;

        JournalFactory(Context context) { this.context = context; }

        /** The entries written on `date`. */
        static java.util.ArrayList<JSONObject> todays(JSONArray entries, String date) {
            java.util.ArrayList<JSONObject> out = new java.util.ArrayList<>();
            for (int i = 0; entries != null && i < entries.length(); i++) {
                JSONObject e = entries.optJSONObject(i);
                if (e != null && date.equals(e.optString("date"))) out.add(e);
            }
            return out;
        }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() {
            JSONObject snapshot = snapshot(context);
            theme = theme(context, snapshot);
            rows.clear();
            JSONArray entries = snapshot.optJSONArray("journal");
            String date = LocalDate.now().toString();
            rows.addAll(todays(entries, date));
            today = !rows.isEmpty();
            if (today) return;
            rows.add(null);
            // The latest two from before today (the snapshot lists the newest first).
            for (int i = 0; entries != null && i < entries.length() && rows.size() < 3; i++) {
                JSONObject e = entries.optJSONObject(i);
                if (e != null && e.optString("date").compareTo(date) < 0) rows.add(e);
            }
        }
        @Override public void onDestroy() {}
        @Override public int getCount() { return rows.size(); }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 2; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }

        @Override public RemoteViews getViewAt(int position) {
            JSONObject e = position < rows.size() ? rows.get(position) : null;
            if (e == null) {
                RemoteViews n = new RemoteViews(context.getPackageName(), R.layout.widget_journal_note);
                n.setInt(R.id.journal_note_bg, "setColorFilter", mix(theme.primary, theme.card, theme.dark ? 0.16f : 0.12f));
                n.setTextColor(R.id.journal_note, theme.foreground);
                n.setTextColor(R.id.journal_recent, theme.mutedForeground);
                n.setViewVisibility(R.id.journal_recent, rows.size() > 1 ? View.VISIBLE : View.GONE);
                n.setOnClickFillInIntent(R.id.journal_note_row, new Intent());
                return n;
            }
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_journal_row);
            v.setInt(R.id.journal_edge, "setColorFilter", today ? theme.primary : theme.mutedForeground);
            v.setTextViewText(R.id.journal_title, e.optString("title"));
            v.setTextColor(R.id.journal_title, theme.foreground);
            // Today's show the time written; earlier ones the day ("Fri", or "Sep 28" from over a week ago).
            String time;
            if (today) time = e.optString("time");
            else {
                boolean thisWeek = false;
                try { thisWeek = !LocalDate.parse(e.optString("date")).isBefore(LocalDate.now().minusDays(6)); } catch (Exception ignored) {}
                time = e.optString(thisWeek ? "weekday" : "short");
            }
            v.setTextViewText(R.id.journal_time, time);
            v.setTextColor(R.id.journal_time, theme.mutedForeground);
            String text = e.optString("text");
            v.setTextViewText(R.id.journal_text, text);
            v.setViewVisibility(R.id.journal_text, text.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextColor(R.id.journal_text, theme.mutedForeground);
            v.setOnClickFillInIntent(R.id.journal_row, new Intent());
            return v;
        }
    }

    /** `t` of color `a` over color `b`, opaque. */
    static int mix(int a, int b, float t) {
        int r = Math.round(android.graphics.Color.red(a) * t + android.graphics.Color.red(b) * (1 - t));
        int g = Math.round(android.graphics.Color.green(a) * t + android.graphics.Color.green(b) * (1 - t));
        int bl = Math.round(android.graphics.Color.blue(a) * t + android.graphics.Color.blue(b) * (1 - t));
        return android.graphics.Color.rgb(r, g, bl);
    }

    // ---- providers (one per widget in the picker) ----

    public abstract static class Base extends AppWidgetProvider {
        @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
            JSONObject snapshot = snapshot(context);
            for (int id : ids) render(context, manager, getClass(), id, snapshot);
            int list = listId(getClass());
            if (list != 0) manager.notifyAppWidgetViewDataChanged(ids, list);
            scheduleTick(context);
        }

        @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
            render(context, manager, getClass(), id, snapshot(context));
            if (getClass() == Schedule.class) manager.notifyAppWidgetViewDataChanged(new int[] { id }, R.id.schedule_list);
        }

        /** A removed timeline forgets which day it last scrolled to. */
        @Override public void onDeleted(Context context, int[] ids) {
            SharedPreferences.Editor prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
            for (int id : ids) prefs.remove("scrolledDay" + id);
            prefs.apply();
        }

        /** With the last widget of all gone, the minute alarm stops. */
        @Override public void onDisabled(Context context) {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            for (Class<?> provider : PROVIDERS) if (manager.getAppWidgetIds(new ComponentName(context, provider)).length > 0) return;
            Intent tick = new Intent(context, TickReceiver.class).setAction(ACTION_TICK);
            context.getSystemService(AlarmManager.class).cancel(
                PendingIntent.getBroadcast(context, 800100, tick, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
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
    public static class Agenda extends Base {}
    public static class Journal extends Base {}
    public static class Tasks extends Base {}
    public static class Habits extends Base {}
}
