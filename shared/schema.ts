import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const KINDS = ["task", "event", "meeting", "habit", "sleep", "focus"] as const;
export type Kind = (typeof KINDS)[number];
export const IMPORT_KINDS = ["event", "task", "meeting", "habit", "focus"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const importKindSchema = z.enum(IMPORT_KINDS).nullable().optional();

export type Recurrence = {
  freq: "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
  interval?: number;
  days?: number[]; // 0=Sun..6=Sat for weekly
  until?: string | null; // YYYY-MM-DD
};

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("event"),
  date: text("date").notNull(), // YYYY-MM-DD anchor
  endDate: text("end_date"), // inclusive last date for all-day items; timed items end at endTime on this date
  availableFrom: text("available_from"), // task can be completed starting this day, with date as its due date
  startTime: text("start_time"), // HH:mm
  endTime: text("end_time"), // HH:mm (may be < start => overnight)
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
  notes: text("notes").notNull().default(""),
  location: text("location").notNull().default(""),
  color: text("color"),
  recurrence: text("recurrence").notNull().default('{"freq":"none"}'),
  exceptions: text("exceptions").notNull().default("[]"),
  completions: text("completions").notNull().default("[]"),
  reminder: integer("reminder"), // minutes before, null = none
  priority: text("priority").notNull().default("normal"),
  autoTimer: integer("auto_timer", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull().default("local"), // local | import | feed:<id>
  uid: text("uid"),
});

export const insertItemSchema = createInsertSchema(items).omit({ id: true });
export type InsertItem = z.infer<typeof insertItemSchema>;
export type Item = typeof items.$inferSelect;

export const feeds = sqliteTable("feeds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  color: text("color").notNull().default("#4f6bd8"),
  importKind: text("import_kind", { enum: IMPORT_KINDS }),
  lastSynced: text("last_synced"),
  eventCount: integer("event_count").notNull().default(0),
  lastError: text("last_error"),
});
export const insertFeedSchema = createInsertSchema(feeds)
  .pick({ name: true, url: true, color: true, importKind: true })
  .extend({ importKind: importKindSchema });
export type InsertFeed = z.infer<typeof insertFeedSchema>;
export type Feed = typeof feeds.$inferSelect;

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id"),
  title: text("title").notNull(),
  date: text("date").notNull(),
  startedAt: text("started_at").notNull(),
  plannedMin: integer("planned_min").notNull(),
  actualSec: integer("actual_sec").notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
});
export const insertSessionSchema = createInsertSchema(sessions).omit({ id: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessions.$inferSelect;

export const journal = sqliteTable("journal", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  body: text("body").notNull(),
  tags: text("tags").notNull().default("[]"), // JSON string[] (lowercase, no #)
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const insertJournalSchema = createInsertSchema(journal).omit({ id: true });
export type InsertJournal = z.infer<typeof insertJournalSchema>;
export type JournalEntry = typeof journal.$inferSelect;

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

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
  haptics: boolean;
  weekStartsOn: 0 | 1;
  lat: number;
  lng: number;
  place: string;
  routines: Routine[];
  colorTheme: ColorTheme;
  appearanceTheme: "light" | "dark";
  habitOrder: number[];
};

export const DEFAULT_SETTINGS: Settings = {
  name: "Joshua",
  wakeTime: "07:00",
  bedTime: "23:00",
  dayStartHour: 6,
  defaultReminder: 10,
  focusMinutes: 25,
  breakMinutes: 5,
  sound: true,
  haptics: true,
  weekStartsOn: 0,
  lat: 39.7029,
  lng: -75.1118,
  place: "Glassboro, NJ",
  routines: [{ id: "sleep", name: "Sleep", startTime: "23:00", endTime: "07:00", color: "#5966AD" }],
  colorTheme: "orange",
  appearanceTheme: "light",
  habitOrder: [],
};
