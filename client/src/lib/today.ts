import type { Item, Settings } from "@shared/schema";
import {
  appearsOn, blocksForDay, canDoTaskOn, completionsOf, kindOf, markOf, occursOn, orderHabits, recOf, routineSchedules, streakOf,
} from "./cal";

/** What the Today page (and the home screen widget) show for a day. */

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
