package app.cadence.planner;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.text.TextPaint;
import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Draws the parts of the widgets that plain widget views can't: the Right now progress ring, the
 * Your day bar, task and habit marks, and the Schedule timeline. Sizes and colors follow the app's
 * CSS (timeline.tsx, today.tsx) so the widgets look like the Today page.
 */
final class WidgetDraw {
    static final int HOUR_DP = 60; // HOUR_PX in timeline.tsx

    private WidgetDraw() {}

    static float density(Context context) {
        return context.getResources().getDisplayMetrics().density;
    }

    /** Color with its alpha multiplied by a (0..1), like CSS "color / a". */
    static int alpha(int color, float a) {
        return Color.argb(Math.round(Color.alpha(color) * a), Color.red(color), Color.green(color), Color.blue(color));
    }

    static int kindIcon(String kind) {
        switch (kind) {
            case "task": return R.drawable.ic_kind_task;
            case "meeting": return R.drawable.ic_kind_meeting;
            case "habit": return R.drawable.ic_kind_habit;
            case "sleep": return R.drawable.ic_kind_sleep;
            case "focus": return R.drawable.ic_kind_focus;
            default: return R.drawable.ic_kind_event;
        }
    }

    private static void icon(Context context, Canvas canvas, int res, int color, float left, float top, float size) {
        Drawable drawable = context.getDrawable(res);
        if (drawable == null) return;
        drawable = drawable.mutate();
        drawable.setTint(color);
        drawable.setBounds(Math.round(left), Math.round(top), Math.round(left + size), Math.round(top + size));
        drawable.draw(canvas);
    }

    /** The Right now ring (Ring in planner.tsx): a track, the elapsed arc, and the item's kind icon. */
    static Bitmap ring(Context context, float pct, int color, int track, String kind) {
        float d = density(context), size = 48 * d, stroke = 4 * d;
        Bitmap bitmap = Bitmap.createBitmap(Math.round(size), Math.round(size), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(stroke);
        RectF oval = new RectF(stroke / 2, stroke / 2, size - stroke / 2, size - stroke / 2);
        paint.setColor(track);
        canvas.drawOval(oval, paint);
        paint.setColor(color);
        paint.setStrokeCap(Paint.Cap.ROUND);
        canvas.drawArc(oval, -90, 360 * Math.max(0, Math.min(1, pct)), false, paint);
        icon(context, canvas, kindIcon(kind), color, size / 2 - 8 * d, size / 2 - 8 * d, 16 * d);
        return bitmap;
    }

    /** The Your day bar: a rounded strip split into free, routine, and planned minutes. */
    static Bitmap dayBar(Context context, int widthDp, JSONArray spans, int[] colors) {
        float d = density(context);
        int w = Math.max(1, Math.round(widthDp * d)), h = Math.round(20 * d);
        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Path clip = new Path();
        clip.addRoundRect(new RectF(0, 0, w, h), h / 2f, h / 2f, Path.Direction.CW);
        canvas.clipPath(clip);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(colors[0]);
        canvas.drawRect(0, 0, w, h, paint);
        float x = 0;
        for (int i = 0; spans != null && i < spans.length(); i++) {
            JSONArray span = spans.optJSONArray(i);
            if (span == null) continue;
            float width = span.optInt(1) / 1440f * w;
            paint.setColor(colors[Math.max(0, Math.min(2, span.optInt(0)))]);
            canvas.drawRect(x, 0, x + width, h, paint);
            x += width;
        }
        return bitmap;
    }

    private static void check(Canvas canvas, float cx, float cy, float s, int color, float d) {
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2.2f * d);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
        paint.setColor(color);
        Path path = new Path();
        path.moveTo(cx - s * 0.32f, cy + s * 0.02f);
        path.lineTo(cx - s * 0.08f, cy + s * 0.26f);
        path.lineTo(cx + s * 0.34f, cy - s * 0.24f);
        canvas.drawPath(path, paint);
    }

    /** A task's checkbox (18px, rounded, filled with a check when done). */
    static Bitmap taskMark(Context context, boolean done, int color, int checkColor) {
        float d = density(context), size = 18 * d;
        Bitmap bitmap = Bitmap.createBitmap(Math.round(size), Math.round(size), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        float inset = 0.75f * d, r = 4 * d;
        RectF box = new RectF(inset, inset, size - inset, size - inset);
        if (done) {
            paint.setColor(color);
            canvas.drawRoundRect(box, r, r, paint);
            check(canvas, size / 2, size / 2, size * 0.66f, checkColor, d);
        } else {
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1.5f * d);
            paint.setColor(color);
            canvas.drawRoundRect(box, r, r, paint);
        }
        return bitmap;
    }

    /** A habit's circle: empty, half (top-left half filled, like fillOf in the app), or done with a check. */
    static Bitmap habitMark(Context context, int mark, int color, int checkColor) {
        float d = density(context), size = 18 * d;
        Bitmap bitmap = Bitmap.createBitmap(Math.round(size), Math.round(size), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        float inset = 0.75f * d;
        RectF oval = new RectF(inset, inset, size - inset, size - inset);
        if (mark == 2) {
            paint.setColor(color);
            canvas.drawOval(oval, paint);
            check(canvas, size / 2, size / 2, size * 0.66f, checkColor, d);
            return bitmap;
        }
        if (mark == 1) {
            canvas.save();
            Path half = new Path();
            half.moveTo(0, 0);
            half.lineTo(size, 0);
            half.lineTo(0, size);
            half.close();
            canvas.clipPath(half);
            paint.setColor(color);
            canvas.drawOval(oval, paint);
            canvas.restore();
        }
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(1.5f * d);
        paint.setColor(color);
        canvas.drawOval(oval, paint);
        return bitmap;
    }

    private static String fit(TextPaint paint, String text, float width) {
        return TextUtils.ellipsize(text, paint, Math.max(0, width), TextUtils.TruncateAt.END).toString();
    }

    /**
     * One hour of the Schedule timeline. Each strip draws the whole day shifted up to its hour and
     * lets the bitmap clip it, so blocks, labels, and the now line join seamlessly across strips.
     */
    static Bitmap hourStrip(Context context, int hour, int widthDp, JSONObject day, WidgetTheme theme, int nowMin) {
        float d = Math.min(density(context), 2.5f); // keeps each strip well under the widget size limit
        float hourPx = HOUR_DP * d;
        int w = Math.max(1, Math.round(widthDp * d)), h = Math.round(hourPx);
        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.translate(0, -hour * hourPx);
        float colLeft = 56 * d, colRight = w - 8 * d, colWidth = colRight - colLeft;
        float dayHeight = 24 * hourPx;

        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        TextPaint text = new TextPaint(Paint.ANTI_ALIAS_FLAG);

        // sky: night, dawn, day, dusk, night (skyGradient in cal.ts)
        if (!day.isNull("sunrise") && !day.isNull("sunset") && day.has("sunrise")) {
            float rise = day.optInt("sunrise"), set = day.optInt("sunset");
            float[] stops = { 0, clamp((rise - 80) / 1440f), clamp(rise / 1440f), clamp((rise + 100) / 1440f),
                clamp((set - 100) / 1440f), clamp(set / 1440f), clamp((set + 80) / 1440f), 1 };
            int[] colors = { theme.skyNight, theme.skyNight, theme.skyDawn, theme.skyDay, theme.skyDay, theme.skyDusk, theme.skyNight, theme.skyNight };
            fill.setShader(new LinearGradient(0, 0, 0, dayHeight, colors, stops, Shader.TileMode.CLAMP));
            canvas.drawRect(colLeft, 0, colRight, dayHeight, fill);
            fill.setShader(null);
        }

        // hour lines and labels
        fill.setColor(alpha(theme.border, 0.7f));
        text.setTextSize(13 * d);
        text.setColor(theme.mutedForeground);
        text.setTextAlign(Paint.Align.RIGHT);
        for (int hr = 0; hr <= 24; hr++) {
            float y = hr * hourPx;
            canvas.drawRect(colLeft, y, colRight, y + Math.max(1, d * 0.75f), fill);
            if (hr > 0 && hr < 24) canvas.drawText(PanelWidgets.time(hr * 60), colLeft - 8 * d, y + 4.5f * d, text);
        }

        // routines: tinted bands with a dashed left edge
        JSONArray routines = day.optJSONArray("routines");
        Paint dash = new Paint(Paint.ANTI_ALIAS_FLAG);
        dash.setStyle(Paint.Style.STROKE);
        dash.setStrokeWidth(2 * d);
        dash.setPathEffect(new DashPathEffect(new float[] { 4 * d, 3 * d }, 0));
        text.setTextAlign(Paint.Align.LEFT);
        for (int i = 0; routines != null && i < routines.length(); i++) {
            JSONObject r = routines.optJSONObject(i);
            if (r == null) continue;
            int color = parse(r.optString("color"), theme.sleep);
            float top = r.optInt("start") / 60f * hourPx, bottom = r.optInt("end") / 60f * hourPx;
            fill.setColor(alpha(color, 0.12f));
            canvas.drawRect(colLeft, top, colRight, bottom, fill);
            dash.setColor(color);
            canvas.drawLine(colLeft + d, top, colLeft + d, bottom, dash);
            text.setTextSize(12 * d);
            text.setFakeBoldText(false);
            text.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
            text.setColor(color);
            canvas.drawText(fit(text, r.optString("title"), colWidth - 12 * d), colLeft + 6 * d, top + 4 * d + 12 * d, text);
        }

        // sunrise and sunset markers
        text.setTypeface(Typeface.DEFAULT);
        text.setTextSize(13 * d);
        text.setColor(theme.mutedForeground);
        text.setTextAlign(Paint.Align.RIGHT);
        if (!day.isNull("sunrise") && day.has("sunrise")) {
            canvas.drawText("Sunrise " + PanelWidgets.time(day.optInt("sunrise")), colRight - 8 * d, day.optInt("sunrise") / 60f * hourPx + 4 * d, text);
            canvas.drawText("Sunset " + PanelWidgets.time(day.optInt("sunset")), colRight - 8 * d, day.optInt("sunset") / 60f * hourPx + 4 * d, text);
        }
        text.setTextAlign(Paint.Align.LEFT);

        // blocks
        JSONArray blocks = day.optJSONArray("blocks");
        for (int i = 0; blocks != null && i < blocks.length(); i++) {
            JSONObject b = blocks.optJSONObject(i);
            if (b == null) continue;
            drawBlock(context, canvas, b, theme, colLeft, colWidth, hourPx, d, nowMin);
        }

        // now line
        if (nowMin >= 0) {
            float y = nowMin / 60f * hourPx;
            fill.setColor(theme.primary);
            canvas.drawRect(colLeft, y - 0.75f * d, colRight, y + 0.75f * d, fill);
            canvas.drawCircle(colLeft + 1 * d, y, 5 * d, fill);
        }
        return bitmap;
    }

    private static void drawBlock(Context context, Canvas canvas, JSONObject b, WidgetTheme theme,
                                  float colLeft, float colWidth, float hourPx, float d, int nowMin) {
        String kind = b.optString("kind", "event"), continues = b.optString("continues");
        boolean fromBefore = "before".equals(continues) || "through".equals(continues);
        boolean intoAfter = "after".equals(continues) || "through".equals(continues);
        int start = b.optInt("start"), end = b.optInt("end");
        int cols = Math.max(1, b.optInt("cols", 1)), col = b.optInt("col");
        int color = parse(b.optString("color"), theme.primary);
        boolean done = b.optBoolean("done");
        float gap = 4 * d;
        float top = fromBefore ? 0 : start / 60f * hourPx + d;
        float height = Math.max((end - start) / 60f * hourPx - 2 * d, 18 * d) + (fromBefore ? d : 0) + (intoAfter ? d : 0);
        float left = colLeft + col * colWidth / cols + gap, width = colWidth / cols - gap * 2;
        RectF rect = new RectF(left, top, left + width, top + height);
        float r = 6 * d;
        float[] radii = {
            fromBefore ? 0 : r, fromBefore ? 0 : r, fromBefore ? 0 : r, fromBefore ? 0 : r,
            intoAfter ? 0 : r, intoAfter ? 0 : r, intoAfter ? 0 : r, intoAfter ? 0 : r,
        };
        Path shape = new Path();
        shape.addRoundRect(rect, radii, Path.Direction.CW);

        int layer = canvas.saveLayerAlpha(rect, done ? 140 : 255);
        canvas.clipPath(shape);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(theme.card);
        canvas.drawRect(rect, paint);
        paint.setColor(alpha(color, "sleep".equals(kind) ? 0.1f : 0.15f));
        canvas.drawRect(rect, paint);
        paint.setColor(color);
        canvas.drawRect(left, top, left + 3 * d, top + height, paint);
        if (nowMin >= start && nowMin < end) {
            Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(3 * d); // 1.5px visible inside the clip
            ring.setColor(color);
            canvas.drawPath(shape, ring);
        }

        boolean tiny = height < 34 * d, checkable = "task".equals(kind) || "habit".equals(kind);
        float x = left + 3 * d + (tiny ? 6 * d : 8 * d);
        float lineTop = tiny ? top + (height - 20 * d) / 2 : top + 4 * d;
        float right = left + width - 8 * d;
        if (checkable) {
            float box = 16 * d, by = lineTop + 2 * d;
            Paint mark = new Paint(Paint.ANTI_ALIAS_FLAG);
            mark.setColor(color);
            if (done) {
                canvas.drawRoundRect(new RectF(x, by, x + box, by + box), 4 * d, 4 * d, mark);
                check(canvas, x + box / 2, by + box / 2, box * 0.66f, theme.card, d);
            } else {
                mark.setStyle(Paint.Style.STROKE);
                mark.setStrokeWidth(d);
                canvas.drawRoundRect(new RectF(x + d / 2, by + d / 2, x + box - d / 2, by + box - d / 2), 4 * d, 4 * d, mark);
            }
            x += box + 6 * d;
        } else {
            icon(context, canvas, kindIcon(kind), color, x, lineTop + 3 * d, 14 * d);
            x += 14 * d + 4 * d;
        }
        TextPaint title = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        title.setTextSize(15 * d);
        title.setColor(theme.foreground);
        title.setStrikeThruText(done);
        canvas.drawText(fit(title, b.optString("title"), right - x), x, lineTop + 15 * d, title);
        if (!tiny) {
            TextPaint sub = new TextPaint(Paint.ANTI_ALIAS_FLAG);
            sub.setTextSize(13 * d);
            sub.setColor(theme.mutedForeground);
            float subX = left + 3 * d + 8 * d;
            canvas.drawText(fit(sub, b.optString("sub"), right - subX), subX, lineTop + 15 * d + 18 * d, sub);
        }
        canvas.restoreToCount(layer);
    }

    private static float clamp(float v) {
        return Math.max(0, Math.min(1, v));
    }

    static int parse(String hex, int fallback) {
        try { return Color.parseColor(hex); } catch (Exception e) { return fallback; }
    }
}
