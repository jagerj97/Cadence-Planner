import type { Item, Recurrence, Kind, Settings } from "@shared/schema";
import { CheckSquare, CalendarDays, Users, Repeat, Moon, Target } from "lucide-react";

export const KIND_META: Record<Kind, { label: string; icon: typeof CheckSquare; cssVar: string }> = {
  task: { label: "Task", icon: CheckSquare, cssVar: "--k-task" },
  event: { label: "Event", icon: CalendarDays, cssVar: "--k-event" },
  meeting: { label: "Meeting", icon: Users, cssVar: "--k-meeting" },
  habit: { label: "Habit", icon: Repeat, cssVar: "--k-habit" },
  sleep: { label: "Sleep", icon: Moon, cssVar: "--k-sleep" },
  focus: { label: "Focus", icon: Target, cssVar: "--k-focus" },
};

export function kindOf(i: Item): Kind {
  return (KIND_META as any)[i.kind] ? (i.kind as Kind) : "event";
}

/** Custom order takes precedence; habits not yet in that order fall back to time of day. */
export function orderHabits(habits: Item[], settings: Settings): Item[] {
  const positions = new Map((settings.habitOrder ?? []).map((id, index) => [id, index]));
  return [...habits].sort((a, b) => {
    const aPos = positions.get(a.id), bPos = positions.get(b.id);
    if (aPos !== undefined || bPos !== undefined) {
      if (aPos === undefined) return 1;
      if (bPos === undefined) return -1;
      return aPos - bPos;
    }
    return (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99") || a.title.localeCompare(b.title) || a.id - b.id;
  });
}

/** returns a CSS color string for an item */
export function colorOf(i: Item): string {
  if (i.color) return i.color;
  return `hsl(var(${KIND_META[kindOf(i)].cssVar}))`;
}
export function tint(i: Item, alpha: number): string {
  if (i.color) return hexAlpha(i.color, alpha);
  return `hsl(var(${KIND_META[kindOf(i)].cssVar}) / ${alpha})`;
}
function hexAlpha(hex: string, a: number) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ---------- dates ---------- */
export const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const todayStr = () => ymd(new Date());
export const addDays = (s: string, n: number) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const dayDiff = (a: string, b: string) => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);
export const dow = (s: string) => parseYmd(s).getDay();
export const toMin = (t: string | null | undefined) => {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};
export const fromMin = (m: number) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
};
export const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};
export function fmtTime(t: string | number | null | undefined, short = false) {
  if (t == null || t === "") return "";
  const m = typeof t === "number" ? t : toMin(t);
  const h = Math.floor(m / 60) % 24, mm = Math.round(m % 60);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (short) return mm === 0 ? `${h12}${ap.toLowerCase()}` : `${h12}:${pad(mm)}${ap.toLowerCase()}`;
  return `${h12}:${pad(mm)} ${ap}`;
}
export function fmtDur(min: number) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r}m`;
  if (!r) return `${h}h`;
  return `${h}h ${r}m`;
}
export function fmtDate(s: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }) {
  return parseYmd(s).toLocaleDateString("en-US", opts);
}
export function startOfWeek(s: string, weekStartsOn = 0) {
  const d = dow(s);
  return addDays(s, -((d - weekStartsOn + 7) % 7));
}
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ---------- recurrence ---------- */
export const recOf = (i: Item): Recurrence => {
  try {
    return JSON.parse(i.recurrence || '{"freq":"none"}');
  } catch {
    return { freq: "none" };
  }
};
const listOf = (s: string | null | undefined): string[] => {
  try {
    return JSON.parse(s || "[]");
  } catch {
    return [];
  }
};
/** Every reminder on an item (minutes before start), latest-firing last, without duplicates. */
export const remindersOf = (i: Pick<Item, "reminder"> & { extraReminders?: string | null }): number[] => {
  if (i.reminder == null) return [];
  const all = [i.reminder, ...(listOf(i.extraReminders) as unknown[])];
  return [...new Set(all.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0))].sort((a, b) => b - a);
};
export const completionsOf = (i: Item) => new Set((listOf(i.completions) as string[]).filter((x) => !x.endsWith("~h")));
/** dates marked half-done (Theme System style partial fill) */
export const partialsOf = (i: Item) => new Set((listOf(i.completions) as string[]).filter((x) => x.endsWith("~h")).map((x) => x.slice(0, -2)));
/** 0 = empty, 1 = half, 2 = full */
export function markOf(i: Item, d: string): 0 | 1 | 2 {
  const l = listOf(i.completions) as string[];
  return l.includes(d) ? 2 : l.includes(d + "~h") ? 1 : 0;
}
/** full or half both keep a streak alive */
const touchedOf = (i: Item) => new Set([...completionsOf(i), ...partialsOf(i)]);
export const exceptionsOf = (i: Item) => new Set(listOf(i.exceptions));

/** Virtual overlay only. The sleep schedule is never saved as a calendar item. */
export function sleepSchedule(settings: Settings): Item {
  const overnight = settings.wakeTime <= settings.bedTime;
  return {
    id: -1,
    uid: "cadence:sleep-schedule",
    source: "schedule",
    title: "Sleep schedule",
    kind: "sleep",
    date: "2000-01-01",
    endDate: overnight ? "2000-01-02" : "2000-01-01",
    availableFrom: null,
    startTime: settings.bedTime,
    endTime: settings.wakeTime,
    allDay: false,
    notes: "",
    location: "",
    color: null,
    recurrence: '{"freq":"daily"}',
    exceptions: "[]",
    completions: "[]",
    reminder: null,
    extraReminders: "[]",
    priority: "normal",
    autoTimer: false,
  };
}

/** Background routines are virtual daily overlays, not stored calendar events. */
export function routineSchedules(settings: Settings): Item[] {
  return settings.routines.map((routine, index) => ({
    id: -1000 - index,
    uid: `cadence:routine:${routine.id}`,
    source: "routine",
    title: routine.name,
    kind: "sleep",
    date: "2000-01-01",
    endDate: routine.endTime <= routine.startTime ? "2000-01-02" : "2000-01-01",
    availableFrom: null,
    startTime: routine.startTime,
    endTime: routine.endTime,
    allDay: false,
    notes: "",
    location: "",
    color: routine.color,
    recurrence: '{"freq":"daily"}',
    exceptions: "[]",
    completions: "[]",
    reminder: null,
    extraReminders: "[]",
    priority: "normal",
    autoTimer: false,
  }));
}

export function occursOn(i: Item, d: string): boolean {
  const r = recOf(i);
  // The schedule in Settings describes every night, including nights before it was saved.
  if ((i.uid === "cadence:sleep-schedule" || i.uid?.startsWith("cadence:routine:")) && i.kind === "sleep" && r.freq === "daily") {
    return !exceptionsOf(i).has(d);
  }
  if (d < i.date) return false;
  if (r.until && d > r.until) return false;
  if (r.freq !== "none" && exceptionsOf(i).has(d)) return false;
  const iv = Math.max(1, r.interval || 1);
  switch (r.freq) {
    case "none":
      return d === i.date;
    case "daily":
      return dayDiff(i.date, d) % iv === 0;
    case "weekdays": {
      const w = dow(d);
      return w >= 1 && w <= 5;
    }
    case "weekly": {
      const days = r.days && r.days.length ? r.days : [dow(i.date)];
      if (!days.includes(dow(d))) return false;
      const weeks = Math.floor(dayDiff(startOfWeek(i.date), startOfWeek(d)) / 7);
      return weeks % iv === 0;
    }
    case "monthly": {
      const a = parseYmd(i.date), b = parseYmd(d);
      if (a.getDate() !== b.getDate()) return false;
      const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
      return months % iv === 0;
    }
    case "yearly":
      return i.date.slice(5) === d.slice(5) && (parseYmd(d).getFullYear() - parseYmd(i.date).getFullYear()) % iv === 0;
  }
  return false;
}

export function recLabel(i: Item): string {
  const r = recOf(i);
  const iv = r.interval && r.interval > 1 ? r.interval : 1;
  switch (r.freq) {
    case "none":
      return "";
    case "daily":
      return iv > 1 ? `Every ${iv} days` : "Every day";
    case "weekdays":
      return "Weekdays";
    case "weekly": {
      const days = (r.days && r.days.length ? r.days : [dow(i.date)]).map((d) => DAY_SHORT[d]).join(", ");
      return (iv > 1 ? `Every ${iv} weeks` : "Weekly") + ` · ${days}`;
    }
    case "monthly":
      return iv > 1 ? `Every ${iv} months` : "Monthly";
    case "yearly":
      return "Yearly";
  }
  return "";
}

/* ---------- occurrences / blocks ---------- */
export type Block = {
  key: string;
  item: Item;
  occDate: string; // the occurrence's own date (for completion tracking)
  start: number; // minutes from display day 00:00
  end: number;
  continues?: "before" | "after" | "through";
  /** the whole occurrence relative to the display day (may run past 1440 or start below 0) */
  fullStart: number;
  fullEnd: number;
  done: boolean;
};

export function isTimed(i: Item) {
  return !i.allDay && !!i.startTime;
}
/** A deadline task is actionable before its due day, but is not a multi-day calendar event. */
export function isDeadlineTask(i: Item) {
  return i.kind === "task" && !!i.availableFrom;
}
export function canDoTaskOn(i: Item, day: string) {
  return isDeadlineTask(i) && i.availableFrom! <= day && day <= i.date;
}
function span(i: Item) {
  const s = toMin(i.startTime);
  const days = i.endDate && i.endDate >= i.date ? Math.min(366, dayDiff(i.date, i.endDate)) : 0;
  let e = days * 1440 + (i.endTime ? toMin(i.endTime) : s + 30);
  if (e <= s) e += 1440; // legacy overnight items without an explicit end date
  return { s, e };
}

/** True on any date covered by a single or recurring occurrence. */
export function appearsOn(i: Item, day: string): boolean {
  const days = i.endDate && i.endDate >= i.date ? Math.min(366, dayDiff(i.date, i.endDate)) : isTimed(i) && toMin(i.endTime) <= toMin(i.startTime) ? 1 : 0;
  if (recOf(i).freq === "none") return day >= i.date && day <= addDays(i.date, days);
  if (occursOn(i, day)) return true;
  for (let offset = 1; offset <= days; offset++) {
    if (occursOn(i, addDays(day, -offset))) return true;
  }
  return false;
}

export function blocksForDay(list: Item[], day: string): Block[] {
  const out: Block[] = [];
  for (const i of list) {
    if (!isTimed(i)) continue;
    const { s, e } = span(i);
    const lastOffset = Math.min(366, Math.ceil(e / 1440) - 1);
    for (let offset = 0; offset <= lastOffset; offset++) {
      const occ = addDays(day, -offset);
      if (!occursOn(i, occ)) continue;
      const start = offset === 0 ? s : 0;
      const end = Math.min(1440, e - offset * 1440);
      if (end <= start) continue;
      out.push({
        key: `${i.id}:${occ}${offset ? `:day${offset}` : ""}`,
        item: i,
        occDate: occ,
        start,
        end,
        continues: offset ? (e > (offset + 1) * 1440 ? "through" : "before") : e > 1440 ? "after" : undefined,
        fullStart: s - offset * 1440,
        fullEnd: e - offset * 1440,
        done: completionsOf(i).has(occ),
      });
    }
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

export function untimedForDay(list: Item[], day: string) {
  return list.filter((i) => !isTimed(i) && appearsOn(i, day));
}

/** lay out overlapping blocks into columns */
export function layoutBlocks(blocks: Block[]) {
  const res: { b: Block; col: number; cols: number }[] = [];
  let cluster: { b: Block; col: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) res.push({ ...c, cols });
    cluster = [];
  };
  for (const b of blocks) {
    if (b.start >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.b.end > b.start).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ b, col });
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  if (cluster.length) flush();
  return res;
}

/** find the next free slot of `dur` minutes on `day` between from and until */
export function findFreeSlot(list: Item[], day: string, dur: number, from: number, until: number) {
  const busy = blocksForDay(list, day)
    .filter((b) => b.item.source !== "schedule")
    .map((b) => [b.start, b.end] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let t = Math.ceil(from / 15) * 15;
  for (const [s, e] of busy) {
    if (e <= t) continue;
    if (s - t >= dur) break;
    t = Math.max(t, Math.ceil(e / 15) * 15);
  }
  if (t + dur <= until) return t;
  return null;
}

export function streakOf(i: Item, today: string) {
  const done = touchedOf(i);
  let cur = 0;
  let d = today;
  // today not required to count yet
  if (!done.has(d)) d = addDays(d, -1);
  for (let n = 0; n < 400; n++) {
    if (d < i.date) break;
    if (occursOn(i, d)) {
      if (done.has(d)) cur++;
      else break;
    }
    d = addDays(d, -1);
  }
  return cur;
}
export function bestStreak(i: Item, today: string) {
  const done = touchedOf(i);
  let best = 0, cur = 0;
  let d = i.date;
  for (let n = 0; n < 800 && d <= today; n++) {
    if (occursOn(i, d)) {
      if (done.has(d)) {
        cur++;
        best = Math.max(best, cur);
      } else if (d !== today) cur = 0;
    }
    d = addDays(d, 1);
  }
  return best;
}
export function rateOf(i: Item, today: string, days = 30) {
  const done = completionsOf(i);
  const half = partialsOf(i);
  let due = 0, hit = 0;
  for (let n = 0; n < days; n++) {
    const d = addDays(today, -n);
    if (d < i.date) break;
    if (occursOn(i, d)) {
      due++;
      if (done.has(d)) hit++;
      else if (half.has(d)) hit += 0.5;
    }
  }
  return due ? hit / due : 0;
}

/* ---------- quick add parser ---------- */
const DAY_WORDS: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

export type Parsed = {
  title: string;
  kind: Kind;
  date: string;
  startTime: string | null;
  endTime: string | null;
  recurrence: Recurrence;
};

function toHM(h: number, m: number, ap?: string) {
  let hh = h;
  if (ap) {
    const p = ap.toLowerCase();
    if (p.startsWith("p") && hh < 12) hh += 12;
    if (p.startsWith("a") && hh === 12) hh = 0;
  }
  return hh * 60 + m;
}

export function parseQuick(input: string, baseDay: string): Parsed {
  let s = " " + input.trim() + " ";
  let kind: Kind | null = null;
  let date = baseDay;
  let start: number | null = null;
  let end: number | null = null;
  let recurrence: Recurrence = { freq: "none" };

  s = s.replace(/\s#(task|event|meeting|habit|sleep|focus)\b/i, (_m, k) => {
    kind = k.toLowerCase();
    return " ";
  });
  s = s.replace(/\s(tomorrow|tmrw)\b/i, () => {
    date = addDays(baseDay, 1);
    return " ";
  });
  s = s.replace(/\stoday\b/i, " ");
  s = s.replace(/\s(every ?day|daily)\b/i, () => {
    recurrence = { freq: "daily" };
    return " ";
  });
  s = s.replace(/\s(every )?weekdays?\b/i, () => {
    recurrence = { freq: "weekdays" };
    return " ";
  });
  s = s.replace(/\s(every|on)\s((?:(?:sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)[a-z]*(?:,?\s*(?:and\s+)?)?)+)/i, (_m, kw, days: string) => {
    const ds = days
      .toLowerCase()
      .split(/[\s,]+|and/)
      .map((w) => w.trim())
      .filter(Boolean)
      .map((w) => DAY_WORDS[w.slice(0, 3)])
      .filter((x) => x != null);
    if (kw.toLowerCase() === "every") recurrence = { freq: "weekly", days: [...new Set(ds)].sort() };
    else if (ds.length) {
      // next such day
      let d = baseDay;
      for (let n = 0; n < 7; n++) {
        if (dow(d) === ds[0]) break;
        d = addDays(d, 1);
      }
      date = d;
    }
    return " ";
  });
  s = s.replace(/\sweekly\b/i, () => {
    recurrence = { freq: "weekly", days: [dow(date)] };
    return " ";
  });
  // range: 3-4pm, 9:30am to 11, 14:00-15:30
  s = s.replace(
    /\s(?:from\s+|at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*(?:-|–|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\b/i,
    (_m, h1, m1, a1, h2, m2, a2) => {
      const ap2 = a2 || a1;
      let ap1 = a1 || a2;
      // "11-1pm": first should be am if it would exceed the second
      if (!a1 && a2 && Number(h1) > Number(h2) && Number(h1) < 12) ap1 = a2.toLowerCase().startsWith("p") ? "am" : "pm";
      start = toHM(Number(h1), Number(m1 || 0), ap1);
      end = toHM(Number(h2), Number(m2 || 0), ap2);
      return " ";
    },
  );
  if (start == null) {
    s = s.replace(/\s(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (_m, h, m, ap) => {
      start = toHM(Number(h), Number(m || 0), ap);
      return " ";
    });
  }
  if (start == null) {
    s = s.replace(/\s(?:at\s+|@\s*)(\d{1,2}):(\d{2})\b/i, (_m, h, m) => {
      start = toHM(Number(h), Number(m), undefined);
      return " ";
    });
  }
  s = s.replace(/\s(noon)\b/i, () => {
    start = 720;
    return " ";
  });
  s = s.replace(/\sfor\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hour|hours)\b/i, (_m, n, u) => {
    const mins = /^h/i.test(u) ? Number(n) * 60 : Number(n);
    if (start != null) end = start + mins;
    else {
      start = null;
      (s as any)._dur = mins;
    }
    return " ";
  });
  if (start != null && end == null) end = start + 60;

  const title = s.replace(/\s+/g, " ").trim() || "Untitled";
  if (!kind) {
    if (/\b(meeting|call|sync|standup|1:1|interview)\b/i.test(title)) kind = "meeting";
    else if (/\b(sleep|nap|bed)\b/i.test(title)) kind = "sleep";
    else if (/\b(focus|deep work|study)\b/i.test(title)) kind = "focus";
    else if (recurrence.freq !== "none") kind = "habit";
    else kind = start != null ? "event" : "task";
  }
  return {
    title,
    kind: kind as Kind,
    date,
    startTime: start != null ? fromMin(start) : null,
    endTime: end != null ? fromMin(end as number) : null,
    recurrence,
  };
}

/* ---------- sunrise / sunset (NOAA approximation) ---------- */
export function sunTimes(day: string, lat: number, lng: number) {
  const d = parseYmd(day);
  const start = new Date(d.getFullYear(), 0, 0);
  const N = Math.floor((d.getTime() - start.getTime()) / 86400000);
  const g = ((2 * Math.PI) / 365) * (N - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const rad = (x: number) => (x * Math.PI) / 180;
  const cosH = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)) - Math.tan(rad(lat)) * Math.tan(decl);
  const tzOff = -new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTimezoneOffset();
  if (cosH > 1) return { sunrise: 720, sunset: 720, polar: "night" as const };
  if (cosH < -1) return { sunrise: 0, sunset: 1440, polar: "day" as const };
  const ha = (Math.acos(cosH) * 180) / Math.PI;
  const sunrise = 720 - 4 * (lng + ha) - eq + tzOff;
  const sunset = 720 - 4 * (lng - ha) - eq + tzOff;
  return { sunrise: Math.max(0, sunrise), sunset: Math.min(1440, sunset), polar: null };
}

export function skyGradient(sunrise: number, sunset: number) {
  const p = (m: number) => `${Math.max(0, Math.min(100, (m / 1440) * 100)).toFixed(2)}%`;
  return `linear-gradient(to bottom,
    hsl(var(--sky-night)) 0%,
    hsl(var(--sky-night)) ${p(sunrise - 80)},
    hsl(var(--sky-dawn)) ${p(sunrise)},
    hsl(var(--sky-day)) ${p(sunrise + 100)},
    hsl(var(--sky-day)) ${p(sunset - 100)},
    hsl(var(--sky-dusk)) ${p(sunset)},
    hsl(var(--sky-night)) ${p(sunset + 80)},
    hsl(var(--sky-night)) 100%)`;
}
