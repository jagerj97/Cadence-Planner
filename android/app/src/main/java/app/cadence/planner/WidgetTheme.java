package app.cadence.planner;

import org.json.JSONObject;

/** The app's theme colors, as the web app resolved them into the widget snapshot (widget.ts). */
final class WidgetTheme {
    final boolean dark;
    final int card, border, foreground, muted, mutedForeground, primary, destructive, task, habit, sleep;
    final int skyNight, skyDawn, skyDay, skyDusk, nowCard, nowBorder;

    WidgetTheme(JSONObject t) {
        if (t == null) t = new JSONObject();
        dark = t.optBoolean("dark");
        card = c(t, "card", "#ffffff");
        border = c(t, "border", "#e7e0d9");
        foreground = c(t, "foreground", "#2b2621");
        muted = c(t, "muted", "#f5f1ed");
        mutedForeground = c(t, "mutedForeground", "#6b6b6b");
        primary = c(t, "primary", "#e66000");
        destructive = c(t, "destructive", "#c93a2e");
        task = c(t, "task", "#c9910d");
        habit = c(t, "habit", "#32855c");
        sleep = c(t, "sleep", "#3f51b5");
        skyNight = c(t, "skyNight", "#1a3f51b5");
        skyDawn = c(t, "skyDawn", "#3dff8c1a");
        skyDay = c(t, "skyDay", "#0dffcc33");
        skyDusk = c(t, "skyDusk", "#33eb4785");
        nowCard = c(t, "nowCard", "#fff4e8");
        nowBorder = c(t, "nowBorder", "#fbd9b8");
    }

    private static int c(JSONObject t, String key, String fallback) {
        return WidgetDraw.parse(t.optString(key, fallback), WidgetDraw.parse(fallback, 0xff888888));
    }
}
