import type { Item, Settings } from "@shared/schema";
import { KIND_META, addDays, blocksForDay, fmtDate, fmtTime, isDeadlineTask, isTimed, kindOf, recLabel, recOf, todayStr, untimedForDay } from "./cal";
import { dayBreakdown, habitRowsFor, taskRowsFor } from "./today";

/**
 * The home screen widget can't read the app's database, so the app hands Android a snapshot of the
 * Today page for the next week. The widget (CadenceWidget.java) picks the current day from it and
 * works out "Right now" itself, so it stays current while the app is closed.
 */
export const WIDGET_DAYS = 7;

const hslToHex = (hsl: string) => {
  const [h, s, l] = hsl.trim().split(/\s+/).map((part) => parseFloat(part));
  if (![h, s, l].every(Number.isFinite)) return "#e66b0a";
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};
const cssVarHex = (name: string) => hslToHex(getComputedStyle(document.documentElement).getPropertyValue(name));
const hexOf = (i: Item) => (i.color && /^#[0-9a-f]{6}$/i.test(i.color) ? i.color : cssVarHex(KIND_META[kindOf(i)].cssVar));

export function widgetSnapshot(items: Item[], settings: Settings) {
  const today = todayStr();
  const days: Record<string, unknown> = {};
  for (let offset = 0; offset < WIDGET_DAYS; offset++) {
    const day = addDays(today, offset);
    const { totals } = dayBreakdown(items, settings, day);
    days[day] = {
      label: fmtDate(day, { weekday: "short", month: "short", day: "numeric" }),
      totals, // minutes free, routine, planned
      blocks: blocksForDay(items, day).map((b) => ({
        title: b.item.title, start: b.start, end: b.end, fullEnd: b.fullEnd,
        startsToday: b.continues !== "before", color: hexOf(b.item), kind: kindOf(b.item),
      })),
      allDay: untimedForDay(items, day)
        .filter((i) => i.allDay || (kindOf(i) !== "task" && kindOf(i) !== "habit"))
        .map((i) => ({ title: i.title, color: hexOf(i) })),
      // Tasks carry "overdue" only when that's still true on this day.
      tasks: taskRowsFor(items, day, true).map(({ i, overdue, done }) => ({
        title: i.title, done, color: hexOf(i),
        sub: [
          overdue ? "Overdue" : "",
          isDeadlineTask(i) ? `Due ${fmtDate(i.date, { month: "short", day: "numeric" })}` : "",
          i.priority === "high" ? "High" : "",
          isTimed(i) ? fmtTime(i.startTime, true) : "",
          recOf(i).freq !== "none" ? recLabel(i) : "",
        ].filter(Boolean).join(" · "),
      })),
      habits: habitRowsFor(items, day, settings).map(({ h, mark, streak }) => ({
        title: h.title, mark, streak, color: hexOf(h),
        sub: [isTimed(h) ? fmtTime(h.startTime, true) : "", recLabel(h)].filter(Boolean).join(" · "),
      })),
    };
  }
  return { version: 1, generatedAt: Date.now(), accent: cssVarHex("--primary"), days };
}
