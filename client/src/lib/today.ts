import type { Item, Settings } from "@shared/schema";
import {
  addDays, appearsOn, blocksForDay, canDoTaskOn, dueDateFor, completionsOf, fmtDate, fmtTime, kindOf, markOf, occursOn, orderHabits, recOf,
  routineSchedules, streakOf, untimedForDay,
} from "./cal";

/** What the Today page (and the home screen widget) show for a day. */

/** Cards on the Today page that can be hidden and reordered from "Customize cards". */
export const TODAY_PANELS = [
  { id: "now", label: "Right now", hint: "What's happening now and next" },
  { id: "day", label: "Your day", hint: "How your day splits between routines, plans, and free time" },
  { id: "schedule", label: "Timeline & agenda", hint: "The day as a timeline or a list" },
  { id: "tasks", label: "Tasks", hint: "Today's tasks" },
  { id: "habits", label: "Habits", hint: "Today's habits" },
] as const;
export type TodayPanel = (typeof TODAY_PANELS)[number]["id"];

/** Cards that start off hidden: they show once turned on in Customize (Settings.shownTodayPanels). */
const OFF_BY_DEFAULT = new Set<string>([]);

/** Whether a card is on: the usual ones unless turned off, the off-by-default ones once turned on. */
export function panelShown(settings: Settings, panel: TodayPanel) {
  return OFF_BY_DEFAULT.has(panel) ? (settings.shownTodayPanels ?? []).includes(panel) : !(settings.hiddenTodayPanels ?? []).includes(panel);
}

/** The settings change that turns a card on or off. */
export function panelToggle(settings: Settings, panel: TodayPanel, on: boolean): Partial<Settings> {
  const key = OFF_BY_DEFAULT.has(panel) ? "shownTodayPanels" : "hiddenTodayPanels";
  const next = new Set(settings[key] ?? []);
  if (on === (key === "shownTodayPanels")) next.add(panel); else next.delete(panel);
  return { [key]: TODAY_PANELS.map((p) => p.id).filter((id) => next.has(id)) };
}

/** Every panel in the user's order; ones they haven't placed keep their default position at the end. */
export function todayPanelOrder(saved: string[] | undefined): TodayPanel[] {
  const ids = TODAY_PANELS.map((p) => p.id) as TodayPanel[];
  const placed = (saved ?? []).filter((id): id is TodayPanel => (ids as string[]).includes(id));
  return [...new Set([...placed, ...ids])];
}

export type TaskRow = { i: Item; occ: string; overdue: boolean; done: boolean };

/** Today's tasks: overdue ones first on the current day, then open before done, high priority, and time. */
export function taskRowsFor(items: Item[], day: string, isToday: boolean): TaskRow[] {
  const tasks = items.filter((i) => kindOf(i) === "task" && (appearsOn(i, day) || canDoTaskOn(i, day)));
  const overdue = isToday
    ? items.filter((i) => kindOf(i) === "task" && recOf(i).freq === "none" && (i.endDate || i.date) < day && !completionsOf(i).has(i.date))
    : [];
  const pr = (x: Item) => (x.priority === "high" ? 0 : x.priority === "normal" ? 1 : 2);
  return [
    ...overdue.map((i) => ({ i, occ: i.date, overdue: true })),
    // A deadline task counts towards the due date it's being done for.
    ...tasks.map((i) => ({ i, occ: dueDateFor(i, day) ?? (recOf(i).freq === "none" ? i.date : day), overdue: false })),
  ]
    .map((r) => ({ ...r, done: completionsOf(r.i).has(r.occ) }))
    .sort((a, b) => Number(a.done) - Number(b.done) || pr(a.i) - pr(b.i) || (a.i.startTime || "99").localeCompare(b.i.startTime || "99"));
}

/**
 * The row at the top of the day's schedule: all-day items, and ones set for anytime that day. Tasks
 * join it on the day they're done or due (a task open before its due date shows on the due date),
 * and leave it once they're checked off. Habits have their own card.
 */
export function allDayFor(items: Item[], day: string): Item[] {
  return untimedForDay(items, day).filter((i) => kindOf(i) !== "habit" &&
    !(kindOf(i) === "task" && completionsOf(i).has(recOf(i).freq === "none" ? i.date : day)));
}

export type HabitRow = { h: Item; mark: 0 | 1 | 2; streak: number };

export function habitRowsFor(items: Item[], day: string, settings: Settings): HabitRow[] {
  return orderHabits(items.filter((i) => kindOf(i) === "habit" && occursOn(i, day)), settings)
    .map((h) => ({ h, mark: markOf(h, day), streak: streakOf(h, day) }));
}

/** Minutes of the day that are free (0), routine (1), or planned (2), as totals and runs. */
export function dayBreakdown(items: Item[], settings: Settings, day: string) {
  const minutes = new Uint8Array(1440);
  // Planned items take precedence where they overlap a background routine.
  for (const block of blocksForDay(routineSchedules(settings), day)) {
    for (let m = Math.max(0, block.start); m < Math.min(1440, block.end); m++) minutes[m] = 1;
  }
  // Tasks are due at a time rather than taking up the half hour they're drawn as.
  for (const block of blocksForDay(items, day).filter((b) => kindOf(b.item) !== "task")) {
    for (let m = Math.max(0, block.start); m < Math.min(1440, block.end); m++) minutes[m] = 2;
  }
  const totals = [0, 0, 0];
  const spans: { category: number; length: number }[] = [];
  for (const category of minutes) {
    totals[category]++;
    const last = spans[spans.length - 1];
    if (last?.category === category) last.length++;
    else spans.push({ category, length: 1 });
  }
  return { totals, spans };
}

/* ---------- agenda ---------- */

export type AgendaEntry = { i: Item; occ: string; time: string; key: string; start: number; done: boolean };

/** One day's entries: all-day (and anytime) items, then timed ones, each piece of a multi-day item. */
export function agendaFor(list: Item[], day: string): AgendaEntry[] {
  const untimed = untimedForDay(list, day).map((i) => {
    const occ = kindOf(i) === "task" && recOf(i).freq === "none" ? i.date : day;
    return { i, occ, key: `${i.id}:${day}`, start: -1, time: kindOf(i) === "task" ? "" : "All day", done: kindOf(i) === "task" && completionsOf(i).has(occ) };
  });
  const timed = blocksForDay(list, day).map((b) => ({
    i: b.item,
    occ: b.occDate,
    key: b.key,
    start: b.continues === "before" || b.continues === "through" ? -1 : b.start,
    time: b.continues === "through" ? "All day"
      : b.continues === "before" ? `Until ${fmtTime(b.item.endTime, true)}`
      : `${fmtTime(b.start, true)} – ${b.continues === "after" ? fmtDate(addDays(day, 1), { month: "short", day: "numeric" }) + ", " + fmtTime(b.item.endTime, true) : fmtTime(b.end, true)}`,
    done: b.done && kindOf(b.item) === "task",
  }));
  return [...untimed, ...timed].sort((a, b) => a.start - b.start || a.i.title.localeCompare(b.i.title));
}
