import type { Item, Settings } from "@shared/schema";
import {
  appearsOn, blocksForDay, canDoTaskOn, completionsOf, kindOf, markOf, occursOn, orderHabits, recOf, routineSchedules, streakOf,
} from "./cal";

/** What the Today page (and the home screen widget) show for a day. */

/** Cards on the Today page that can be hidden and reordered from "Customize cards". */
export const TODAY_PANELS = [
  { id: "now", label: "Right now", hint: "What's happening now and next" },
  { id: "day", label: "Your day", hint: "How your day splits between routines, plans, and free time" },
  { id: "schedule", label: "Schedule", hint: "All-day items and the timeline" },
  { id: "tasks", label: "Tasks", hint: "Today's tasks" },
  { id: "habits", label: "Habits", hint: "Today's habits" },
] as const;
export type TodayPanel = (typeof TODAY_PANELS)[number]["id"];

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
    ...tasks.map((i) => ({ i, occ: recOf(i).freq === "none" ? i.date : day, overdue: false })),
  ]
    .map((r) => ({ ...r, done: completionsOf(r.i).has(r.occ) }))
    .sort((a, b) => Number(a.done) - Number(b.done) || pr(a.i) - pr(b.i) || (a.i.startTime || "99").localeCompare(b.i.startTime || "99"));
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
  for (const block of blocksForDay(items, day)) {
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
