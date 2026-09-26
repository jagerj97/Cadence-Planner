import type { Item, Settings } from "@shared/schema";
import {
  KIND_META, addDays, blocksForDay, fmtDate, fmtTime, isDeadlineTask, isTimed, kindOf, layoutBlocks, recLabel, recOf,
  routineSchedules, sunTimes, todayStr, untimedForDay,
} from "./cal";
import { dayBreakdown, habitRowsFor, taskRowsFor } from "./today";

/**
 * The home screen widgets (PanelWidgets.java) can't read the app's database, so the app hands
 * Android a snapshot of the Today page for the next week, with the colors of the current theme.
 * The widgets pick today from it and work out "Right now" themselves, so they keep up while the
 * app is closed. Tapping a task or habit in a widget queues the change for the app (see
 * applyWidgetActions in androidApi.ts).
 */
export const WIDGET_DAYS = 7;

/** "H S% L%" or "H S% L% / A" (a CSS variable's value) to "#rrggbb" or "#aarrggbb" for Android. */
const hslToHex = (hsl: string) => {
  const [color, alphaPart] = hsl.split("/");
  const [h, s, l] = color.trim().split(/\s+/).map((part) => parseFloat(part));
  if (![h, s, l].every(Number.isFinite)) return "#e66b0a";
  const alpha = alphaPart === undefined ? "" : Math.round(Math.min(1, Math.max(0, parseFloat(alphaPart))) * 255).toString(16).padStart(2, "0");
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${alpha}${f(0)}${f(8)}${f(4)}`;
};
const cssVarHex = (name: string) => hslToHex(getComputedStyle(document.documentElement).getPropertyValue(name));
const hexOf = (i: Item) => (i.color && /^#[0-9a-f]{6}$/i.test(i.color) ? i.color : cssVarHex(KIND_META[kindOf(i)].cssVar));

/** Blends two "#rrggbb" colors: t of the first over the second. */
const mixHex = (a: string, b: string, t: number) => "#" + [1, 3, 5].map((i) =>
  Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, "0")).join("");

function theme(settings: Settings) {
  const dark = settings.appearanceTheme === "dark";
  const v = (name: string) => cssVarHex(`--${name}`);
  return {
    dark,
    card: v("card"), border: v("border"), foreground: v("foreground"), muted: v("muted"), mutedForeground: v("muted-foreground"),
    primary: v("primary"), destructive: v("destructive"), task: v("k-task"), habit: v("k-habit"), sleep: v("k-sleep"),
    skyNight: v("sky-night"), skyDawn: v("sky-dawn"), skyDay: v("sky-day"), skyDusk: v("sky-dusk"),
    // The Right now card's tint of the color theme (.wellness-now in index.css).
    nowCard: mixHex(v("primary"), v("card"), dark ? .18 : .09), nowBorder: mixHex(v("primary"), v("card"), .25),
  };
}

export function widgetSnapshot(items: Item[], settings: Settings) {
  const today = todayStr();
  const days: Record<string, unknown> = {};
  for (let offset = 0; offset < WIDGET_DAYS; offset++) {
    const day = addDays(today, offset);
    const { totals, spans } = dayBreakdown(items, settings, day);
    const sun = sunTimes(day, settings.lat, settings.lng);
    days[day] = {
      label: fmtDate(day, { weekday: "short", month: "short", day: "numeric" }),
      totals, // minutes free, routine, planned
      spans: spans.map((s) => [s.category, s.length]),
      sunrise: sun.polar ? null : Math.round(sun.sunrise),
      sunset: sun.polar ? null : Math.round(sun.sunset),
      blocks: layoutBlocks(blocksForDay(items, day)).map(({ b, col, cols }) => ({
        title: b.item.title, start: b.start, end: b.end, fullStart: b.fullStart, fullEnd: b.fullEnd,
        continues: b.continues ?? "", col, cols, done: b.done, kind: kindOf(b.item), color: hexOf(b.item),
        // The line under the title, as the timeline shows it.
        sub: (b.continues === "before" || b.continues === "through"
          ? b.continues === "through" ? "continues" : "until " + fmtTime(b.item.endTime, true)
          : `${fmtTime(b.start, true)} – ${b.continues === "after"
            ? b.item.endDate && b.item.endDate > b.occDate ? `ends ${b.item.endDate}` : fmtTime(b.item.endTime, true) + " next day"
            : fmtTime(b.end, true)}`) + (b.item.location ? ` · ${b.item.location}` : ""),
      })),
      routines: blocksForDay(routineSchedules(settings), day).map((b) => ({
        title: b.item.title, start: b.start, end: b.end, color: hexOf(b.item),
      })),
      allDay: untimedForDay(items, day)
        .filter((i) => i.allDay || (kindOf(i) !== "task" && kindOf(i) !== "habit"))
        .map((i) => ({ title: i.title, color: hexOf(i) })),
      tasks: taskRowsFor(items, day, true).map(({ i, occ, overdue, done }) => ({
        id: i.id, occ, title: i.title, done, overdue,
        due: isDeadlineTask(i) ? `Due ${fmtDate(i.date, { month: "short", day: "numeric" })}` : "",
        high: i.priority === "high",
        time: isTimed(i) ? fmtTime(i.startTime, true) : "",
        rec: recOf(i).freq !== "none" ? recLabel(i) : "",
      })),
      habits: habitRowsFor(items, day, settings).map(({ h, mark, streak }) => ({
        id: h.id, title: h.title, mark, streak,
        sub: `${isTimed(h) ? fmtTime(h.startTime, true) + " · " : ""}${recLabel(h)}`,
      })),
    };
  }
  return { version: 2, generatedAt: Date.now(), theme: theme(settings), days };
}
