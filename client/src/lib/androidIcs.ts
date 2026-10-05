import ICAL from "ical.js";
import type { InsertItem, Item, Recurrence } from "@shared/schema";
import { addDays, listOf, pad, parseYmd, recOf, remindersOf, ymd } from "./cal";

const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const dayAfter = (date: string) => addDays(date, 1);
const dateOf = (t: ICAL.Time, tz: string) => {
  if (t.isDate) return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(t.toJSDate());
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
};
const timeOf = (t: ICAL.Time, tz: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(t.toJSDate());
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.hour}:${value.minute}`;
};
const value = (component: ICAL.Component, key: string) =>
  String(component.getFirstPropertyValue(key) ?? "");

function category(component: ICAL.Component): string {
  const categories = value(component, "categories").toLowerCase();
  for (const kind of ["task", "event", "meeting", "habit", "sleep", "focus"]) {
    if (categories.split(",").includes(kind)) return kind;
  }
  const title = value(component, "summary").toLowerCase();
  if (/\b(sleep|bed ?time|nap)\b/.test(title)) return "sleep";
  if (/\b(focus|deep work)\b/.test(title)) return "focus";
  if (/\b(meeting|sync|standup|1:1|call|interview)\b/.test(title)) return "meeting";
  return "event";
}

function row(component: ICAL.Component, start: ICAL.Time, end: ICAL.Time, tz: string, source: string): InsertItem {
  const allDay = start.isDate;
  const date = dateOf(start, tz), endDate = dateOf(end, tz);
  const alarms = component.getAllSubcomponents("valarm").flatMap((alarm) => {
    const trigger = alarm.getFirstPropertyValue("trigger") as ICAL.Duration | null;
    return trigger && typeof trigger.toSeconds === "function" ? [Math.max(0, Math.round(-trigger.toSeconds() / 60))] : [];
  });
  const alarmMinutes = alarms.length ? alarms[0] : null;
  return {
    title: value(component, "summary") || "(untitled)",
    kind: category(component),
    date,
    endDate: allDay ? (endDate > dayAfter(date) ? previousDay(endDate) : null) : endDate > date ? endDate : null,
    availableFrom: null,
    startTime: allDay ? null : timeOf(start, tz),
    endTime: allDay ? null : timeOf(end, tz),
    allDay,
    notes: value(component, "description").slice(0, 4000),
    location: value(component, "location"),
    color: null,
    recurrence: '{"freq":"none"}',
    exceptions: "[]",
    completions: "[]",
    reminder: allDay ? null : alarmMinutes ?? 30,
    extraReminders: JSON.stringify(allDay ? [] : alarms.slice(1)),
    priority: "normal",
    autoTimer: false,
    source,
    uid: value(component, "uid") || null,
  };
}
const previousDay = (date: string) => addDays(date, -1);

/**
 * A repeat rule as Cadence keeps it, or null when it says more than Cadence's repeats can (several
 * days of the month, "the 2nd Tuesday", extra dates...); those are listed date by date instead.
 * A rule ending after a number of repeats (COUNT) gets the date of its last one as its end.
 */
function recurrence(component: ICAL.Component, event: ICAL.Event, tz: string): Recurrence | null {
  const rrule = component.getFirstPropertyValue("rrule") as ICAL.Recur | null;
  if (!rrule || component.getAllProperties("rrule").length > 1 || component.getFirstProperty("rdate")) return null;
  const freq = rrule.freq.toLowerCase();
  const parts = (rrule.parts ?? {}) as Record<string, unknown[]>;
  const used = Object.keys(parts).filter((key) => parts[key]?.length);
  const byday = (parts.BYDAY ?? []) as string[];
  const start = event.startDate;
  const only = (key: string, value: number) => (parts[key] ?? []).length === 1 && Number(parts[key][0]) === value;
  let rec: Recurrence | null = null;
  if (freq === "daily" && !used.length) rec = { freq: "daily", interval: rrule.interval || 1 };
  else if (freq === "weekly" && used.every((key) => key === "BYDAY") && byday.every((d) => days.includes(d))) {
    const selected = byday.map((d) => days.indexOf(d)).sort();
    rec = { freq: selected.join(",") === "1,2,3,4,5" && (rrule.interval || 1) === 1 ? "weekdays" : "weekly", interval: rrule.interval || 1, days: selected };
  } else if (freq === "monthly" && used.every((key) => key === "BYMONTHDAY" && only(key, start.day))) rec = { freq: "monthly", interval: rrule.interval || 1 };
  else if (freq === "yearly" && used.every((key) => (key === "BYMONTH" && only(key, start.month)) || (key === "BYMONTHDAY" && only(key, start.day)))) {
    rec = { freq: "yearly", interval: rrule.interval || 1 };
  }
  if (!rec) return null;
  // The last day it can start, in the calendar's time (an UNTIL in UTC can fall on the next day there).
  if (rrule.until) return { ...rec, until: dateOf(rrule.until, tz) };
  if (rrule.count) {
    const iterator = event.iterator();
    let last: ICAL.Time | null = null;
    for (let n = 0; n < rrule.count && n < 100000; n++) {
      const next = iterator.next();
      if (!next) break;
      last = next;
    }
    return last ? { ...rec, until: dateOf(last, tz) } : null;
  }
  return { ...rec, until: null };
}

/** Past this many items, the one-off events furthest from today are left out (repeating ones always stay). */
const MAX_ITEMS = 10000;
/** At most this many dates are listed for one repeating event that Cadence can't keep as a repeat. */
const MAX_PER_SERIES = 800;

/**
 * Reads an .ics calendar into items. Repeating events become one repeating item each, except rules
 * Cadence can't keep, which are listed date by date from 60 days ago to 400 days ahead. `skipped`
 * counts the old one-off events left out of a calendar too big to keep whole.
 */
export function parseAndroidIcs(text: string, tz: string, source: string): { items: InsertItem[]; skipped: number } {
  if (new TextEncoder().encode(text).byteLength > 8 * 1024 * 1024) throw new Error("Calendar is too large (8 MB maximum)");
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That file isn't a valid .ics calendar");
  if (/^RRULE:[^\r\n]*FREQ=(SECONDLY|MINUTELY|HOURLY)\b/mi.test(text)) throw new Error("Sub-hourly repeating calendars aren't supported");
  const root = new ICAL.Component(ICAL.parse(text));
  const events = root.getAllSubcomponents("vevent");
  if (events.length > 50000) throw new Error("Calendar has too many entries");
  const overrides = new Map<string, ICAL.Component[]>();
  for (const component of events) {
    if (!component.getFirstProperty("recurrence-id")) continue;
    const key = value(component, "uid");
    overrides.set(key, [...(overrides.get(key) ?? []), component]);
  }
  const output: InsertItem[] = [];
  const append = (item: InsertItem) => { output.push(item); };
  const windowStart = Date.now() - 60 * 86400000, windowEnd = Date.now() + 400 * 86400000;
  for (const component of events) {
    if (component.getFirstProperty("recurrence-id") || value(component, "status").toUpperCase() === "CANCELLED") continue;
    const event = new ICAL.Event(component);
    if (!event.startDate) continue;
    const base = row(component, event.startDate, event.endDate, tz, source);
    const exceptions = component.getAllProperties("exdate").flatMap((property) =>
      property.getValues().map((date) => dateOf(date as ICAL.Time, tz)));
    const changed = overrides.get(value(component, "uid")) ?? [];
    const overrideDates = changed.map((c) => dateOf(c.getFirstPropertyValue("recurrence-id") as ICAL.Time, tz));
    const seen = new Set([...exceptions, ...overrideDates]);
    if (!component.getFirstProperty("rrule") && !component.getFirstProperty("rdate")) append(base);
    else {
      const rec = recurrence(component, event, tz);
      if (rec) append({ ...base, recurrence: JSON.stringify(rec), exceptions: JSON.stringify([...seen]) });
      else {
        // Walk the dates up to the window's end; ones before it are passed over without counting
        // towards the limit, so a series that began years ago still shows its current dates.
        const iterator = event.iterator();
        let listed = 0;
        for (let steps = 0; steps < 200000 && listed < MAX_PER_SERIES; steps++) {
          const occurrence = iterator.next();
          if (!occurrence) break;
          const millis = occurrence.toJSDate().getTime();
          if (millis > windowEnd) break;
          if (millis < windowStart || seen.has(dateOf(occurrence, tz))) continue;
          const details = event.getOccurrenceDetails(occurrence);
          append(row(component, details.startDate, details.endDate, tz, source));
          listed++;
        }
      }
    }
    for (const override of changed) {
      if (value(override, "status").toUpperCase() === "CANCELLED") continue;
      const specific = new ICAL.Event(override);
      append(row(override, specific.startDate, specific.endDate, tz, source));
    }
  }
  if (output.length <= MAX_ITEMS) return { items: output, skipped: 0 };
  // Too many to keep: every repeating event, then the one-off events nearest today.
  const today = ymd(new Date());
  const repeating = output.filter((item) => item.recurrence !== '{"freq":"none"}');
  const away = (date: string) => Math.abs(new Date(date + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime());
  const oneOff = output.filter((item) => item.recurrence === '{"freq":"none"}').sort((a, b) => away(a.date) - away(b.date));
  const kept = oneOff.slice(0, Math.max(0, MAX_ITEMS - repeating.length));
  return { items: [...repeating, ...kept], skipped: output.length - repeating.length - kept.length };
}

const escapeIcs = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const compact = (s: string) => s.replace(/[-:]/g, "");
const foldIcs = (line: string) => {
  const encoder = new TextEncoder();
  const folded: string[] = [];
  let part = "", size = 0;
  for (const char of line) {
    const length = encoder.encode(char).byteLength;
    if (size + length > 73) {
      folded.push(part);
      part = " " + char;
      size = 1 + length;
    } else {
      part += char;
      size += length;
    }
  }
  folded.push(part);
  return folded.join("\r\n");
};
export function exportAndroidIcs(items: Item[], tz: string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cadence Android//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Cadence"];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  for (const it of items) {
    lines.push("BEGIN:VEVENT", `UID:${(it.uid || `cadence-${it.id}@cadence.app`).replace(/[\r\n]/g, "")}`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeIcs(it.title)}`);
    if (it.startTime && !it.allDay) {
      lines.push(`DTSTART;TZID=${tz}:${compact(it.date)}T${compact(it.startTime)}00`);
      const end = it.endDate || (it.endTime && it.endTime <= it.startTime ? dayAfter(it.date) : it.date);
      lines.push(`DTEND;TZID=${tz}:${compact(end)}T${compact(it.endTime || it.startTime)}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(it.date)}`, `DTEND;VALUE=DATE:${compact(dayAfter(it.endDate || it.date))}`);
    }
    const recurrence: Recurrence = recOf(it);
    if (recurrence.freq !== "none") {
      let rule = recurrence.freq === "weekdays" ? "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" : `FREQ=${recurrence.freq.toUpperCase()}`;
      if (recurrence.interval && recurrence.interval > 1) rule += `;INTERVAL=${recurrence.interval}`;
      if (recurrence.freq === "weekly" && recurrence.days?.length) rule += `;BYDAY=${recurrence.days.map((d) => days[d]).join(",")}`;
      // Weeks count from Sunday, as in Cadence (calendars default to Monday).
      if (recurrence.freq === "weekly" && (recurrence.interval ?? 1) > 1) rule += ";WKST=SU";
      // The end of its last day: a date for all-day items, else that day's local midnight in UTC.
      if (recurrence.until) {
        if (!it.startTime || it.allDay) rule += `;UNTIL=${compact(recurrence.until)}`;
        else {
          const d = parseYmd(recurrence.until);
          rule += `;UNTIL=${new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
        }
      }
      lines.push(`RRULE:${rule}`);
      for (const date of listOf(it.exceptions)) {
        lines.push(it.startTime && !it.allDay
          ? `EXDATE;TZID=${tz}:${compact(date)}T${compact(it.startTime)}00`
          : `EXDATE;VALUE=DATE:${compact(date)}`);
      }
    }
    if (it.notes) lines.push(`DESCRIPTION:${escapeIcs(it.notes)}`);
    if (it.location) lines.push(`LOCATION:${escapeIcs(it.location)}`);
    if (it.startTime && !it.allDay) {
      for (const minutes of remindersOf(it)) {
        lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Cadence reminder",
          `TRIGGER:${minutes === 0 ? "PT0M" : `-PT${minutes}M`}`, "END:VALARM");
      }
    }
    lines.push(`CATEGORIES:${it.kind.toUpperCase()}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcs).join("\r\n") + "\r\n";
}
