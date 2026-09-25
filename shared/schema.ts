// Plain types for Cadence's stored records. The Android app keeps them in IndexedDB as JSON.

export const KINDS = ["task", "event", "meeting", "habit", "sleep", "focus"] as const;
export type Kind = (typeof KINDS)[number];
export const IMPORT_KINDS = ["event", "task", "meeting", "habit", "focus"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export type Recurrence = {
  freq: "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
  interval?: number;
  days?: number[]; // 0=Sun..6=Sat for weekly
  until?: string | null; // YYYY-MM-DD
};

export type Item = {
  id: number;
  title: string;
  kind: string;
  date: string; // YYYY-MM-DD anchor
  endDate: string | null; // inclusive last date for all-day items; timed items end at endTime on this date
  availableFrom: string | null; // task can be completed starting this day, with date as its due date
  startTime: string | null; // HH:mm
  endTime: string | null; // HH:mm (may be < start => overnight)
  allDay: boolean;
  notes: string;
  location: string;
  color: string | null;
  recurrence: string; // JSON Recurrence
  exceptions: string; // JSON string[] of skipped dates
  completions: string; // JSON string[] of completed dates
  reminder: number | null; // minutes before, null = none
  extraReminders: string; // JSON list of more minutes-before values
  priority: string;
  autoTimer: boolean;
  source: string; // local | import | feed:<id> | routine
  uid: string | null;
};
/** A new item: title and date are required, everything else falls back to a default. */
export type InsertItem = Pick<Item, "title" | "date"> & Partial<Omit<Item, "id" | "title" | "date">>;

export type Feed = {
  id: number;
  name: string;
  url: string;
  color: string;
  importKind: ImportKind | null;
  lastSynced: string | null;
  eventCount: number;
  lastError: string | null;
};

export type Session = {
  id: number;
  itemId: number | null;
  title: string;
  date: string;
  startedAt: string;
  plannedMin: number;
  actualSec: number;
  completed: boolean;
};

export type JournalEntry = {
  id: number;
  date: string;
  body: string;
  tags: string; // JSON string[] (lowercase, no #)
  createdAt: string;
  updatedAt: string;
};

export type Routine = { id: string; name: string; startTime: string; endTime: string; color: string };
export const COLOR_THEMES = ["tomato", "orange", "blueberry", "plum", "avocado", "monochrome"] as const;
export type ColorTheme = (typeof COLOR_THEMES)[number];
export type Settings = {
  name: string;
  wakeTime: string;
  bedTime: string;
  dayStartHour: number;
  defaultReminder: number | null;
  focusMinutes: number;
  breakMinutes: number;
  sound: boolean;
  inAppPopups: boolean; // false = alerts only as system notifications (errors still show)
  haptics: boolean;
  weekStartsOn: 0 | 1;
  lat: number;
  lng: number;
  place: string;
  routines: Routine[];
  colorTheme: ColorTheme;
  appearanceTheme: "light" | "dark";
  habitOrder: number[];
  hiddenTodayPanels: string[]; // Today page panels the user turned off (see TODAY_PANELS)
  todayPanelOrder: string[]; // Today page panel order; panels missing from it follow in the default order
};

export const DEFAULT_SETTINGS: Settings = {
  name: "Joshua",
  wakeTime: "07:00",
  bedTime: "23:00",
  dayStartHour: 6,
  defaultReminder: 10,
  focusMinutes: 30,
  breakMinutes: 5,
  sound: true,
  inAppPopups: true,
  haptics: true,
  weekStartsOn: 0,
  lat: 39.7029,
  lng: -75.1118,
  place: "Glassboro, NJ",
  routines: [{ id: "sleep", name: "Sleep", startTime: "23:00", endTime: "07:00", color: "#5966AD" }],
  colorTheme: "orange",
  appearanceTheme: "light",
  habitOrder: [],
  hiddenTodayPanels: [],
  todayPanelOrder: [],
};
