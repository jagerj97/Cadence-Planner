import ICAL from "ical.js";
import type { InsertItem, Item, Recurrence } from "@shared/schema";

const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayAfter = (date: string) => {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return ymd(d);
};
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
  const trigger = component.getFirstSubcomponent("valarm")?.getFirstPropertyValue("trigger") as ICAL.Duration | null;
  const alarmMinutes = trigger && typeof trigger.toSeconds === "function"
    ? Math.max(0, Math.round(-trigger.toSeconds() / 60)) : null;
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
    reminder: allDay ? null : alarmMinutes ?? 10,
    priority: "normal",
    autoTimer: false,
    source,
    uid: value(component, "uid") || null,
  };
}
const previousDay = (date: string) => {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return ymd(d);
};

function recurrence(component: ICAL.Component): Recurrence | null {
  const rrule = component.getFirstPropertyValue("rrule") as ICAL.Recur | null;
  if (!rrule) return null;
  const freq = rrule.freq.toLowerCase();
  const byday = ((rrule.parts as Record<string, unknown>)?.BYDAY ?? []) as string[];
  if (freq === "daily" && !byday.length) return {
    freq: "daily", interval: rrule.interval || 1, until: rrule.until ? dateOf(rrule.until, "UTC") : null,
  };
  if (freq === "weekly" && byday.every((d) => days.includes(d))) {
    const selected = byday.map((d) => days.indexOf(d)).sort();
    return {
      freq: selected.join(",") === "1,2,3,4,5" && rrule.interval === 1 ? "weekdays" : "weekly",
      interval: rrule.interval || 1, days: selected,
      until: rrule.until ? dateOf(rrule.until, "UTC") : null,
    };
  }
  if (["monthly", "yearly"].includes(freq) && !byday.length) return {
    freq: freq as "monthly" | "yearly", interval: rrule.interval || 1,
    until: rrule.until ? dateOf(rrule.until, "UTC") : null,
  };
  return null;
}

export function parseAndroidIcs(text: string, tz: string, source: string, mode: "map" | "expand"): InsertItem[] {
  if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) throw new Error("Calendar is too large (2 MB maximum)");
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That file isn't a valid .ics calendar");
  if (/^RRULE:[^\r\n]*FREQ=(SECONDLY|MINUTELY|HOURLY)\b/mi.test(text)) throw new Error("Sub-hourly repeating calendars aren't supported");
  const root = new ICAL.Component(ICAL.parse(text));
  const events = root.getAllSubcomponents("vevent");
  if (events.length > 5000) throw new Error("Calendar has too many entries");
  const overrides = new Map<string, ICAL.Component[]>();
  for (const component of events) {
    if (!component.getFirstProperty("recurrence-id")) continue;
    const key = value(component, "uid");
    overrides.set(key, [...(overrides.get(key) ?? []), component]);
  }
  const output: InsertItem[] = [];
  const append = (item: InsertItem) => {
    if (output.length >= 5000) throw new Error("Calendar expands to too many events");
    output.push(item);
  };
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
    if (!component.getFirstProperty("rrule")) append(base);
    else {
      const rec = recurrence(component);
      if (mode === "map" && rec) append({
        ...base, recurrence: JSON.stringify(rec), exceptions: JSON.stringify([...seen]),
      });
      else {
        const iterator = event.iterator();
        for (let n = 0; n < 800; n++) {
          const occurrence = iterator.next();
          if (!occurrence) break;
          const millis = occurrence.toJSDate().getTime();
          if (millis > windowEnd) break;
          if (millis < windowStart || seen.has(dateOf(occurrence, tz))) continue;
          const details = event.getOccurrenceDetails(occurrence);
          append(row(component, details.startDate, details.endDate, tz, source));
        }
      }
    }
    for (const override of changed) {
      if (value(override, "status").toUpperCase() === "CANCELLED") continue;
      const specific = new ICAL.Event(override);
      append(row(override, specific.startDate, specific.endDate, tz, source));
    }
  }
  return output;
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
    const recurrence: Recurrence = JSON.parse(it.recurrence || '{"freq":"none"}');
    if (recurrence.freq !== "none") {
      let rule = recurrence.freq === "weekdays" ? "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" : `FREQ=${recurrence.freq.toUpperCase()}`;
      if (recurrence.interval && recurrence.interval > 1) rule += `;INTERVAL=${recurrence.interval}`;
      if (recurrence.freq === "weekly" && recurrence.days?.length) rule += `;BYDAY=${recurrence.days.map((d) => days[d]).join(",")}`;
      if (recurrence.until) rule += `;UNTIL=${compact(recurrence.until)}T235959Z`;
      lines.push(`RRULE:${rule}`);
      for (const date of JSON.parse(it.exceptions || "[]") as string[]) {
        lines.push(it.startTime && !it.allDay
          ? `EXDATE;TZID=${tz}:${compact(date)}T${compact(it.startTime)}00`
          : `EXDATE;VALUE=DATE:${compact(date)}`);
      }
    }
    if (it.notes) lines.push(`DESCRIPTION:${escapeIcs(it.notes)}`);
    if (it.location) lines.push(`LOCATION:${escapeIcs(it.location)}`);
    if (it.reminder != null && it.startTime && !it.allDay) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Cadence reminder",
        `TRIGGER:${it.reminder === 0 ? "PT0M" : `-PT${it.reminder}M`}`, "END:VALARM");
    }
    lines.push(`CATEGORIES:${it.kind.toUpperCase()}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcs).join("\r\n") + "\r\n";
}
