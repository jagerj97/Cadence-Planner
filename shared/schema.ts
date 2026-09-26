// Plain types for Cadence's stored records. The Android app keeps them in IndexedDB as JSON.

export const KINDS = ["task", "event", "meeting", "habit", "sleep", "focus"] as const;
export type Kind = (typeof KINDS)[number];
/** The journal tag an item's notes get, by kind. */
export const KIND_TAGS: Record<Kind, string> = { task: "tasks", event: "events", meeting: "meetings", habit: "habits", sleep: "sleep", focus: "focus" };
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
  /** The journal entry holding this item's notes; null once it's removed, missing if never synced. */
  journalId?: number | null;
  /** True when the user chose to keep this item's notes out of the journal. */
  journalOff?: boolean;
  /** A task's tags (JSON string[] of names from Settings.taskTags). */
  tags?: string;
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
  /** Whether this calendar's event notes become journal entries. */
  journalNotes?: boolean;
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
  itemId?: number | null; // the planner item whose notes this entry mirrors
  createdAt: string;
  updatedAt: string;
};

/** A task tag and the color it gives a task's checkbox. */
export type TaskTag = { name: string; color: string };
export type Routine = { id: string; name: string; startTime: string; endTime: string; color: string };
// Red, orange, yellow, green, blue, violet and grey.
export const COLOR_THEMES = ["ribbon", "carrot", "butter", "grass", "denim", "plum", "mouse"] as const;
/** Earlier theme names, and what they became. */
export const RENAMED_THEMES: Record<string, ColorTheme> = {
  tomato: "ribbon", orange: "carrot", lemon: "butter", avocado: "grass", blueberry: "denim", blackberry: "denim", monochrome: "mouse", mushroom: "mouse",
};
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
  routines: Routine[];
  colorTheme: ColorTheme;
  appearanceTheme: "light" | "dark";
  habitOrder: number[];
  hiddenTodayPanels: string[]; // Today page panels the user turned off (see TODAY_PANELS)
  todayPanelOrder: string[]; // Today page panel order; panels missing from it follow in the default order
  taskTags: TaskTag[];
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
  routines: [{ id: "sleep", name: "Sleep", startTime: "23:00", endTime: "07:00", color: "#3f51b5" }],
  colorTheme: "carrot",
  appearanceTheme: "dark",
  habitOrder: [],
  hiddenTodayPanels: [],
  todayPanelOrder: [],
  taskTags: [],
};
