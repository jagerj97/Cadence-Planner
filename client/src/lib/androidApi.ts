import { COLOR_THEMES, DEFAULT_SETTINGS, DISPLAY_MODES, IMPORT_KINDS, RENAMED_THEMES, canonicalTag, hashtagsIn } from "@shared/schema";
import { KIND_TAGS, type Feed, type InsertItem, type Item, type JournalEntry, type Session, type Settings } from "@shared/schema";
import { exportAndroidIcs, parseAndroidIcs } from "./androidIcs";
import { widgetSnapshot } from "./widget";
import { queryClient } from "./queryClient";
import { APP_VERSION } from "./changelog";
import { addDays, anytimeRemindersFor, blocksForDay, completionsOf, fmtDur, lastDayOffset, listOf, notifyTimesOf, parseYmd, recOf, remindersOf, span, todayStr } from "./cal";

export interface AndroidBridge {
  setAppearance?(mode: "light" | "dark"): void;
  /** Switches to the plain app and notification icons ("Let Cadence outside"), or back. Older builds lack it. */
  setPlain?(plain: boolean): void;
  /** Whether the phone is set to dark mode (Display mode: System setting). Older builds lack it. */
  systemDark?(): boolean;
  /** The status bar's height in dp: the page draws behind it (older builds lack it). */
  insetTop?(): number;
  /** The navigation bar's height in dp: the page's bottom bar runs behind it (older builds lack it). */
  insetBottom?(): number;
  /** "Play a sound": whether notifications (reminders, a finished timer) make their sound. Older builds lack it. */
  setSound?(on: boolean): void;
  /** The same from the Settings switch, then closes the app. Older builds lack it. */
  letOutside?(plain: boolean): void;
  requestLocation?(): void;
  haptic?(kind: string): void;
  fetchCalendar(url: string): string;
  /** fetchCalendar, asking the server first whether it changed ({"notModified": true} if not). Older builds lack it. */
  fetchCalendarIfChanged?(url: string, etag: string, lastModified: string): string;
  saveIcs(text: string): void;
  saveBackup(text: string): void;
  notify(title: string, body: string): void;
  requestNotifications(): void;
  notificationsAllowed(): boolean;
  scheduleReminders(json: string): void;
  scheduleFocus(at: number, title: string, body: string): void;
  cancelFocus(): void;
  finishFocus(title: string, body: string): void;
  getFocus(): string;
  saveFocus(json: string): void;
  /** A session stopped from the timer notification, waiting to be logged (JSON or "null"). Older builds lack it. */
  takeFocusStop?(): string;
  /** Hands the home screen widget a snapshot of the Today page (see widget.ts). Older builds lack it. */
  updateWidget?(json: string): void;
  /** Task and habit taps made on the widgets, waiting for the app (JSON array). Older builds lack it. */
  takeWidgetActions?(): string;
  /** What a widget button asked the app to do when it opened it ("add-task", "add-habit"), or "". */
  takeLaunchAction?(): string;
}
declare global {
  interface Window { CadenceAndroid?: AndroidBridge; }
}

type StoreName = "items" | "feeds" | "journal" | "sessions" | "settings";
const dbReady = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("cadence-private", 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    for (const store of ["items", "feeds", "journal", "sessions"] as StoreName[]) {
      db.createObjectStore(store, { keyPath: "id", autoIncrement: true });
    }
    db.createObjectStore("settings", { keyPath: "key" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function read<T>(store: StoreName, id: number | string): Promise<T | undefined> {
  const db = await dbReady;
  return result(db.transaction(store, "readonly").objectStore(store).get(id));
}
async function list<T>(store: StoreName): Promise<T[]> {
  const db = await dbReady;
  return result(db.transaction(store, "readonly").objectStore(store).getAll());
}
async function put<T extends object>(store: StoreName, entry: T): Promise<T & { id: number }> {
  const db = await dbReady;
  const copy: Record<string, any> = { ...entry };
  if (copy.id == null) delete copy.id;
  // Tasks aren't all-day; one saved that way (an import, a kind change) is done anytime that day.
  if (store === "items" && copy.kind === "task" && copy.allDay) copy.allDay = false;
  // A task with a time is due at that moment: no end time (it's drawn as a half-hour block) or end date.
  if (store === "items" && copy.kind === "task" && copy.startTime && (copy.endTime || copy.endDate)) {
    copy.endTime = null;
    copy.endDate = null;
  }
  const id = await result(db.transaction(store, "readwrite").objectStore(store).put(copy));
  return { ...copy, ...(store === "settings" ? {} : { id: Number(id) }) } as T & { id: number };
}
async function remove(store: StoreName, id: number | string) {
  const db = await dbReady;
  await result(db.transaction(store, "readwrite").objectStore(store).delete(id));
}
let mutation = Promise.resolve<unknown>(undefined);
const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
  const next = mutation.then(work, work);
  mutation = next.catch(() => {});
  return next;
};
// Current theme names, plus renamed ones that saved settings and backups may still hold.
const KNOWN_THEMES = new Set<string>([...COLOR_THEMES, ...Object.keys(RENAMED_THEMES)]);
const pref = async (): Promise<Settings> => {
  const saved = (await read<{ key: string; value: Settings }>("settings", "prefs"))?.value;
  // A new install has nothing new to show, so it starts as having seen this version.
  const merged = { ...DEFAULT_SETTINGS, ...(saved ? {} : { seenVersion: APP_VERSION }), ...saved };
  // Themes that were renamed carry over to their new names, and routines on the old default blue
  // move to the blue swatch so it shows as picked.
  return {
    ...merged,
    colorTheme: RENAMED_THEMES[merged.colorTheme] ?? merged.colorTheme,
    // Settings from before Display mode keep the look they had.
    displayMode: saved?.displayMode ?? (saved?.appearanceTheme === "light" ? "light" : "dark"),
    // The default reminder became 30 minutes; settings still on the old default (10) move to it once.
    ...(saved && !saved.reminderDefault30 ? { defaultReminder: saved.defaultReminder === 10 || saved.defaultReminder === undefined ? 30 : saved.defaultReminder, reminderDefault30: true } : {}),
    // "Joshua" was a placeholder default, not a name anyone entered.
    name: merged.name === "Joshua" ? "" : merged.name,
    routines: merged.routines.map((r) => (r.color?.toLowerCase() === "#5966ad" ? { ...r, color: "#3f51b5" } : r)),
  };
};
const bodyJSON = async (input?: BodyInit | null) => input ? JSON.parse(String(input)) : {};
const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8" },
});
const fail = (message: string, status = 400) => ok({ message }, status);
const validDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s + "T12:00:00Z")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
const validTime = (s: unknown) => s == null || typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function validItem(it: Item | InsertItem): boolean {
  if (!it.title?.trim() || !validDate(it.date) || it.endDate && (!validDate(it.endDate) || it.endDate < it.date) ||
      !validTime(it.startTime) || !validTime(it.endTime) || !validTime(it.remindAt)) return false;
  // A one-off task can be done from a day up to its due date (and time, if it has one).
  if (it.availableFrom && (it.kind !== "task" || !validDate(it.availableFrom) || it.availableFrom > it.date ||
      it.allDay || recOf(it as Item).freq !== "none")) return false;
  // Days before each due date a (repeating) task can be done: a whole number of days.
  if (it.leadDays != null && (it.kind !== "task" || !Number.isInteger(it.leadDays) || it.leadDays < 1 || it.leadDays > 365 ||
      it.availableFrom)) return false;
  return true;
}
const entryTitle = (title: unknown) => (typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : null);
/** An entry's tags: its text's #hashtags (unless it has them turned off) and the ones added to it. */
const normTags = (body: string, tags: unknown, useHashtags = true) => {
  const found = new Set<string>(useHashtags ? hashtagsIn(body) : []);
  if (Array.isArray(tags)) for (const tag of tags) {
    if (typeof tag === "string" && tag.trim()) found.add(canonicalTag(tag.trim().replace(/^#/, "").toLowerCase()));
  }
  return JSON.stringify([...found]);
};
/**
 * An item's notes live on as a journal entry on the day the item begins, tagged with its kind
 * (#events, #meetings...), except for habits. Saving the item keeps the entry's text, date and tag current, clearing
 * the notes removes it, and editing the entry in the journal edits the notes. "Show notes in
 * journal" in the item's details (journalOff) turns this off and on; deleting the entry turns it off.
 */
const kindTags = new Set(Object.values(KIND_TAGS));
async function syncNotes(item: Item, notesChanged: boolean): Promise<Item> {
  // Habits keep their notes to themselves; an item that becomes a habit gives up its entry.
  const notes = item.kind === "habit" || item.journalOff ? "" : (item.notes || "").trim();
  const tag = KIND_TAGS[item.kind as keyof typeof KIND_TAGS] ?? KIND_TAGS.event;
  const linked = item.journalId ? await read<JournalEntry>("journal", item.journalId) : undefined;
  if (linked) {
    if (!notes) {
      await remove("journal", linked.id);
      return put("items", { ...item, journalId: null });
    }
    const tags = normTags(notes, [...(JSON.parse(linked.tags) as string[]).filter((t) => !kindTags.has(t)), tag]);
    if (linked.body !== notes || linked.date !== item.date || linked.tags !== tags) {
      await put("journal", { ...linked, body: notes, date: item.date, tags, updatedAt: linked.body !== notes ? new Date().toISOString() : linked.updatedAt });
    }
    return item;
  }
  if (!notes || !notesChanged) return item;
  const now = new Date().toISOString();
  const entry = await put("journal", { date: item.date, body: notes, tags: normTags(notes, [tag]), itemId: item.id, createdAt: now, updatedAt: now });
  return put("items", { ...item, journalId: entry.id });
}
/** Items saved before notes became journal entries get theirs once, and all-day tasks become anytime that day. */
const backfillNotes = () => exclusive(async () => {
  for (const item of await list<Item>("items")) {
    if (item.kind === "task" && (item.allDay || item.startTime && (item.endTime || item.endDate))) await put("items", item);
    if (item.journalId === undefined && !item.journalOff && item.source === "local" && item.notes?.trim()) await syncNotes(item, true);
  }
  // Entries saved before #meeting counted as #meetings (and so on) get the one tag.
  for (const entry of await list<JournalEntry>("journal")) {
    const tags = JSON.stringify([...new Set(listOf(entry.tags).map(canonicalTag))]);
    if (tags !== entry.tags) await put("journal", { ...entry, tags });
  }
});
/**
 * Deletes an item along with what belongs to it: the journal entry holding its notes, and a focus
 * session that was saved to the calendar as it.
 */
async function removeItem(item: Item) {
  if (item.journalId) await remove("journal", item.journalId);
  for (const session of await list<Session>("sessions")) if (session.calendarItemId === item.id) await remove("sessions", session.id);
  await remove("items", item.id);
}
let notesBackfilled: Promise<void> | null = null;

/** A quick fingerprint of a downloaded calendar (cyrb53), to tell whether it changed since the last sync. */
function fingerprintOf(text: string) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** A calendar link's task tag from a request: a tag name, or null for none. */
const feedTag = (data: Record<string, any>) => (typeof data.tag === "string" && data.tag.trim() ? data.tag.trim() : null);
/** The tags a calendar link gives an item it imports: its tag, on tasks only. */
const tagsFor = (feed: Feed, kind: string | undefined) => JSON.stringify(feed.tag && kind === "task" ? [feed.tag] : []);

/** A routine's days: missing (every day), or some of 0–6 (Sunday first), each once. */
const validDays = (days: unknown) => days === undefined || (Array.isArray(days) && days.length > 0 &&
  new Set(days).size === days.length && days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6));

/** Settings that can be saved (and restored): the lists are lists, and the routines, tags and themes valid. */
function validSettings(s: Record<string, any>) {
  return Array.isArray(s.habitOrder) && Array.isArray(s.hiddenTodayPanels) && Array.isArray(s.todayPanelOrder) &&
    Array.isArray(s.taskTags) && s.taskTags.every((t: any) => typeof t?.name === "string" && t.name && /^#[0-9a-f]{6}$/i.test(t.color)) &&
    ["light", "dark"].includes(s.appearanceTheme) && (DISPLAY_MODES as readonly string[]).includes(s.displayMode) &&
    KNOWN_THEMES.has(s.colorTheme) &&
    Array.isArray(s.routines) && s.routines.every((r: any) => r && typeof r.name === "string" && r.name.trim() &&
      typeof r.startTime === "string" && typeof r.endTime === "string" && validTime(r.startTime) && validTime(r.endTime) &&
      r.startTime !== r.endTime && validDays(r.days));
}

const normalizedUrl = (raw: string) => {
  const url = new URL(raw.trim().replace(/^webcal:\/\//i, "https://"));
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.port ||
      url.username || url.password || url.hash || raw.length > 4096 ||
      /(^|\.)((local|localhost|internal|invalid|test))$/i.test(url.hostname) ||
      /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.includes(":")) {
    throw new Error("Enter a public HTTPS iCal subscription URL");
  }
  return url.href;
};

/** The local time `minutes` after midnight on `date`, as a timestamp (right on daylight saving days too). */
const localAt = (date: string, minutes: number) => {
  const d = parseYmd(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes).getTime();
};

async function refreshNotifications(remindersToo: boolean) {
  const bridge = window.CadenceAndroid;
  // The web version's stand-in bridge has no widget or reminders, so there's nothing to build.
  if (!bridge?.scheduleReminders || window.cadenceWeb) return;
  const items = await list<Item>("items");
  try {
    bridge.updateWidget?.(JSON.stringify(widgetSnapshot(items, await pref(), await list<JournalEntry>("journal"))));
  } catch { /* the widget is optional */ }
  if (!remindersToo) return;
  // `start` lets the notification count down to it (older builds show `body` as it is).
  const reminders: { at: number; start: number; title: string; body: string }[] = [];
  const now = Date.now();
  // Far enough ahead that an item's longest reminder still falls within the next 31 days.
  const longest = Math.max(0, ...items.map((item) => remindersOf(item)[0] ?? 0));
  for (let offset = -1; offset < 32 + Math.ceil(longest / 1440); offset++) {
    const date = addDays(todayStr(), offset);
    for (const block of blocksForDay(items, date)) {
      const item = block.item;
      // Only the day an item starts gets its reminders (not the days it carries on through).
      if (block.continues === "before" || block.continues === "through" || !item.startTime || item.kind === "sleep") continue;
      const kind = item.kind ? `${item.kind[0].toUpperCase()}${item.kind.slice(1)}: ` : "";
      // Every timed item notifies as it starts, and at each reminder before that.
      for (const minutes of notifyTimesOf(item)) {
        const at = localAt(date, block.start - minutes);
        if (at <= now || at > now + 31 * 86400000) continue;
        reminders.push({
          at,
          start: localAt(date, block.start),
          title: kind + item.title,
          body: minutes === 0 ? (item.kind === "task" ? "Due now" : "Starting now") : `${item.kind === "task" ? "Due" : "Starts"} in ${fmtDur(minutes)}`,
        });
      }
    }
  }
  // Any-time tasks: "due today" as each day they're due starts, and at their reminder time.
  const settings = await pref();
  for (let offset = 0; offset < 32; offset++) {
    const date = addDays(todayStr(), offset);
    for (const { item, at: minutes } of anytimeRemindersFor(items, date, settings)) {
      const at = localAt(date, minutes);
      if (at <= now) continue;
      reminders.push({ at, start: at, title: `Task: ${item.title}`, body: "Due today" });
    }
  }
  reminders.sort((a, b) => a.at - b.at);
  bridge.scheduleReminders(JSON.stringify(reminders.slice(0, 128)));
}

/**
 * Refreshes the widgets (and with `remindersToo`, the reminders) shortly after a change, once for a
 * burst of changes. The change is already saved, so a failure here never fails it.
 */
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshReminders = false;
function queueRefresh(remindersToo: boolean) {
  refreshReminders ||= remindersToo;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const reminders = refreshReminders;
    refreshReminders = false;
    void refreshNotifications(reminders).catch(() => {});
  }, 300);
}

/**
 * Whether an item is finished, so its journal entry moves to the Archive: a task once it's checked off,
 * an event, meeting or focus time once it's over. Repeating ones finish only after their last repeat
 * (a repeating task never does).
 */
function itemFinished(item: Item, now: Date): boolean {
  const r = recOf(item);
  if (item.kind === "task") return r.freq === "none" && completionsOf(item).has(item.date);
  if (item.kind !== "event" && item.kind !== "meeting" && item.kind !== "focus") return false;
  // Over once its last occurrence ends, counting the days an overnight or multi-day one runs into.
  const lastStart = r.freq === "none" ? item.date : r.until;
  if (!lastStart) return false;
  const day = parseYmd(lastStart);
  if (item.allDay || !item.startTime) return now >= new Date(day.getFullYear(), day.getMonth(), day.getDate() + lastDayOffset(item) + 1);
  return now >= new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, span(item).e);
}

/** Archives the entries of items that have finished, and brings back ones whose item is no longer finished. */
async function archiveFinished() {
  const now = new Date();
  const items = new Map((await list<Item>("items")).map((item) => [item.id, item]));
  let changed = false;
  for (const entry of await list<JournalEntry>("journal")) {
    const item = entry.itemId ? items.get(entry.itemId) : undefined;
    if (!item) continue;
    const finished = itemFinished(item, now);
    if (finished === !!entry.archivedAuto) continue;
    await put("journal", { ...entry, archived: finished, archivedAuto: finished });
    changed = true;
  }
  // The journal widget leaves archived entries out.
  if (changed) queueRefresh(false);
}

const backupStores: StoreName[] = ["items", "feeds", "journal", "sessions", "settings"];
type BackupRows = Record<StoreName, Record<string, any>[]>;
type Backup = {
  format: "cadence-android-backup";
  version: 1;
  exportedAt: string;
  tables: BackupRows;
  focus: unknown;
};
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const hasId = (value: Record<string, any>) =>
  Number.isSafeInteger(value.id) && value.id > 0;
const jsonArray = (value: unknown) => {
  try { return Array.isArray(JSON.parse(String(value))); } catch { return false; }
};

function validateBackup(value: unknown): Backup {
  if (!record(value) || value.format !== "cadence-android-backup" || value.version !== 1 ||
      !record(value.tables) || typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))) {
    throw new Error("Not a supported Cadence Android backup");
  }
  const tables = value.tables as BackupRows;
  const limits: Record<StoreName, number> = {
    items: 20000, feeds: 2000, journal: 20000, sessions: 20000, settings: 10,
  };
  for (const store of backupStores) {
    if (!Array.isArray(tables[store]) || tables[store].length > limits[store]) {
      throw new Error(`Invalid ${store} data in backup`);
    }
    const keys = new Set<number | string>();
    for (const entry of tables[store]) {
      if (!record(entry) || (store === "settings" ? typeof entry.key !== "string" || entry.key !== "prefs" : !hasId(entry))) {
        throw new Error(`Invalid ${store} record in backup`);
      }
      const key = store === "settings" ? entry.key : entry.id;
      if (keys.has(key)) throw new Error(`Duplicate ${store} record in backup`);
      keys.add(key);
      if (store === "items" && (
        !validItem(entry as Item) || typeof entry.kind !== "string" || typeof entry.source !== "string" ||
        typeof entry.notes !== "string" || typeof entry.recurrence !== "string" ||
        !jsonArray(entry.exceptions) || !jsonArray(entry.completions)
      )) throw new Error("Invalid planner item in backup");
      if (store === "feeds" && (
        typeof entry.name !== "string" || typeof entry.url !== "string" ||
        normalizedUrl(entry.url) !== entry.url
      )) throw new Error("Invalid calendar subscription in backup");
      if (store === "journal" && (
        !validDate(entry.date) || typeof entry.body !== "string" ||
        !jsonArray(entry.tags) || !Number.isFinite(Date.parse(entry.createdAt))
      )) throw new Error("Invalid journal entry in backup");
      if (store === "sessions" && (
        !validDate(entry.date) || typeof entry.title !== "string" ||
        !Number.isFinite(Date.parse(entry.startedAt)) || !Number.isFinite(entry.actualSec)
      )) throw new Error("Invalid focus session in backup");
      // The same check as saving settings, so a restored backup can always be saved again.
      if (store === "settings" && (!record(entry.value) || !validSettings({ ...DEFAULT_SETTINGS, ...entry.value })))
        throw new Error("Invalid settings in backup");
    }
  }
  if (value.focus !== null && (
    !record(value.focus) || !["focus", "break"].includes(value.focus.mode) ||
    typeof value.focus.title !== "string" || !Number.isFinite(value.focus.plannedSec) ||
    value.focus.plannedSec <= 0 || !Number.isFinite(value.focus.accSec) ||
    value.focus.accSec < 0 || (value.focus.runStart !== null && !Number.isFinite(value.focus.runStart))
  )) throw new Error("Invalid focus timer in backup");
  return value as Backup;
}

async function restoreBackup(backup: Backup) {
  const db = await dbReady;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(backupStores, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("Restore was rolled back"));
    tx.onerror = () => reject(tx.error || new Error("Could not restore backup"));
    for (const store of backupStores) {
      const target = tx.objectStore(store);
      target.clear();
      for (const entry of backup.tables[store]) target.put(entry);
    }
  });
  window.CadenceAndroid!.saveFocus(JSON.stringify(backup.focus));
  await refreshNotifications(true).catch(() => {});
}

async function localApi(method: string, path: string, data: any): Promise<Response> {
  if (path === "/api/backup" && method === "GET") {
    return exclusive(async () => ok({
      format: "cadence-android-backup", version: 1, exportedAt: new Date().toISOString(),
      tables: {
        items: await list<Item>("items"),
        feeds: await list<Feed>("feeds"),
        journal: await list<JournalEntry>("journal"),
        sessions: await list<Session>("sessions"),
        settings: await list<{ key: string; value: Settings }>("settings"),
      },
      focus: JSON.parse(window.CadenceAndroid!.getFocus() || "null"),
    }));
  }
  if (path === "/api/backup/restore" && method === "POST") {
    let backup: Backup;
    try { backup = validateBackup(data); }
    catch (cause) { return fail(cause instanceof Error ? cause.message : "Invalid backup", 400); }
    try {
      await exclusive(() => restoreBackup(backup));
      notesBackfilled = null;
      return ok({ restored: true });
    } catch {
      return fail("Could not restore this backup. Your existing data was not changed", 500);
    }
  }
  if (path === "/api/items" && method === "GET") {
    await (notesBackfilled ??= backfillNotes().catch(() => {}));
    return ok(await list<Item>("items"));
  }
  if (path === "/api/items" && method === "POST") {
    if (!validItem(data)) return fail("Enter a valid title, date and time");
    const { journalId: _, ...fresh } = data;
    return exclusive(async () => ok(await syncNotes(await put("items", fresh), true)));
  }
  if (path === "/api/items/retag" && method === "POST") return exclusive(async () => {
    const from = String(data.from || ""), to = data.to ? String(data.to) : null;
    for (const item of await list<Item>("items")) {
      const tags = listOf(item.tags);
      if (!tags.includes(from)) continue;
      const next = to ? [...new Set(tags.map((t) => (t === from ? to : t)))] : tags.filter((t) => t !== from);
      await put("items", { ...item, tags: JSON.stringify(next) });
    }
    return ok({ ok: true });
  });
  const itemRoute = /^\/api\/items\/(\d+)(?:\/(toggle|cycle|skip))?$/.exec(path);
  if (itemRoute) return exclusive(async () => {
    const id = Number(itemRoute[1]), item = await read<Item>("items", id);
    if (!item) return fail("Not found", 404);
    // A synced item comes and goes with its calendar.
    if (item.source.startsWith("feed:") && (method === "DELETE" && !itemRoute[2] || itemRoute[2] === "skip")) {
      return fail("Synced items can't be deleted", 403);
    }
    if (method === "DELETE" && !itemRoute[2]) {
      await removeItem(item);
      return ok({ ok: true });
    }
    if (method === "PATCH" && !itemRoute[2]) {
      const merged = { ...item, ...data, id: item.id, source: item.source, uid: item.uid, journalId: item.journalId, ...(item.source.startsWith("feed:") && data.kind && data.kind !== item.kind ? { color: null } : {}) };
      if (!validItem(merged)) return fail("Enter a valid title, date and time");
      const notesChanged = typeof data.notes === "string" && data.notes.trim() !== (item.notes || "").trim() ||
        item.kind === "habit" && merged.kind !== "habit" || data.journalOff === false;
      return ok(await syncNotes(await put("items", merged), notesChanged));
    }
    if (method !== "POST" || !itemRoute[2]) return fail("Unsupported action", 405);
    const date = item.kind === "task" && item.availableFrom ? item.date : String(data.date || "");
    if (!validDate(date)) return fail("Choose a valid date");
    if (itemRoute[2] === "skip") {
      const dates = new Set<string>(JSON.parse(item.exceptions || "[]"));
      dates.add(date);
      return ok(await put("items", { ...item, exceptions: JSON.stringify([...dates]) }));
    }
    const dates = new Set<string>(JSON.parse(item.completions || "[]"));
    if (itemRoute[2] === "cycle") {
      if (dates.has(date)) dates.delete(date);
      else if (dates.has(date + "~h")) { dates.delete(date + "~h"); dates.add(date); }
      else dates.add(date + "~h");
    } else {
      if (dates.has(date)) dates.delete(date); else dates.add(date);
      dates.delete(date + "~h");
    }
    return ok(await put("items", { ...item, completions: JSON.stringify([...dates].sort()) }));
  });
  if (path === "/api/settings" && method === "GET") return ok(await pref());
  if (path === "/api/settings" && method === "PUT") {
    // In turn with other changes, so two quick saves can't each overwrite the other.
    return exclusive(async () => {
      const next = { ...await pref(), ...data };
      if (!validSettings(next)) return fail("Check routine settings, theme and habit order");
      await put("settings", { key: "prefs", value: next });
      return ok(next);
    });
  }
  if (path === "/api/feeds" && method === "GET") return ok(await list<Feed>("feeds"));
  if (path === "/api/feeds" && method === "POST") {
    try {
      if (!data.name?.trim() || data.importKind && !IMPORT_KINDS.includes(data.importKind)) return fail("Choose a valid name and import type");
      return ok(await put("feeds", {
        name: data.name.trim(), url: normalizedUrl(data.url), color: data.color || "#4f6bd8",
        importKind: data.importKind || null, lastSynced: null, eventCount: 0, lastError: null, journalNotes: !!data.journalNotes,
        useColor: !!data.useColor, tag: feedTag(data),
      }));
    } catch { return fail("Enter a valid calendar URL"); }
  }
  const feedRoute = /^\/api\/feeds\/(\d+)(?:\/sync)?$/.exec(path);
  if (feedRoute) {
    const id = Number(feedRoute[1]);
    // Editing a connected calendar. A changed notes choice applies to its items now; a changed
    // "Import items as" applies on the next sync.
    if (method === "PATCH") return exclusive(async () => {
      const feed = await read<Feed>("feeds", id);
      if (!feed) return fail("Calendar not found", 404);
      if (data.importKind && !IMPORT_KINDS.includes(data.importKind)) return fail("Choose a valid import type");
      let url = feed.url;
      try { if (typeof data.url === "string" && data.url.trim()) url = normalizedUrl(data.url); } catch { return fail("Enter a valid calendar URL"); }
      const importKind = data.importKind === undefined ? feed.importKind : data.importKind || null;
      const next: Feed = {
        ...feed, url,
        name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : feed.name,
        importKind, useColor: data.useColor === undefined ? feed.useColor : !!data.useColor,
        color: typeof data.color === "string" && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : feed.color,
        journalNotes: data.journalNotes === undefined ? feed.journalNotes : !!data.journalNotes,
        resetKinds: feed.resetKinds || importKind !== feed.importKind,
        tag: data.tag === undefined ? feed.tag ?? null : feedTag(data),
      };
      next.resetTags = feed.resetTags || (next.tag ?? null) !== (feed.tag ?? null);
      // A new link is a different calendar: nothing from the last download carries over.
      if (url !== feed.url) Object.assign(next, { etag: null, lastModified: null, fingerprint: null });
      next.resetColors = feed.resetColors || next.useColor !== feed.useColor || (!!next.useColor && next.color !== feed.color);
      if (!!next.journalNotes !== !!feed.journalNotes) {
        for (const item of await list<Item>("items")) {
          if (item.source !== `feed:${id}`) continue;
          await syncNotes(await put("items", { ...item, journalOff: !next.journalNotes }), !!next.journalNotes);
        }
      }
      return ok(await put("feeds", next));
    });
    if (method === "DELETE") return exclusive(async () => {
      await remove("feeds", id);
      for (const item of await list<Item>("items")) if (item.source === `feed:${id}`) await removeItem(item);
      return ok({ ok: true });
    });
    if (method === "POST" && path.endsWith("/sync")) {
      const feed = await read<Feed>("feeds", id);
      if (!feed) return fail("Calendar not found", 404);
      try {
        const bridge = window.CadenceAndroid!;
        const tz = data.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
        // Settings changed since the last sync have to reach every item, so those syncs read it all.
        const resetting = !!(feed.resetKinds || feed.resetColors || feed.resetTags);
        // What's imported from the same file depends on the day (old events are left out) and time zone.
        const readFor = `${todayStr()}|${tz}`;
        const sameRead = !resetting && !!feed.fingerprint && feed.fingerprint.endsWith(`|${readFor}`);
        const fetched = JSON.parse(sameRead && bridge.fetchCalendarIfChanged
          ? bridge.fetchCalendarIfChanged(feed.url, feed.etag ?? "", feed.lastModified ?? "")
          : bridge.fetchCalendar(feed.url));
        if (fetched.error) throw new Error(fetched.error);
        const markSynced = () => exclusive(async () => {
          const current = await read<Feed>("feeds", id);
          if (!current) return fail("Calendar not found", 404);
          return ok(await put("feeds", { ...current, lastSynced: new Date().toISOString(), lastError: null }));
        });
        // The server says nothing changed: nothing to read.
        if (fetched.notModified) return markSynced();
        const fingerprint = `${fingerprintOf(fetched.text)}|${readFor}`;
        // The same file as last time, read for the same day: nothing to read either.
        if (sameRead && fingerprint === feed.fingerprint) {
          await exclusive(async () => {
            const current = await read<Feed>("feeds", id);
            if (current) await put("feeds", { ...current, etag: fetched.etag ?? null, lastModified: fetched.lastModified ?? null });
          });
          return markSynced();
        }
        const parsed = parseAndroidIcs(fetched.text, tz, `feed:${id}`).items;
        // A repeating event and a changed date of it can share a start date, so repeats are matched apart.
        const keyOf = (item: InsertItem | Item) => `${item.uid || item.title}\0${item.date}\0${item.recurrence === '{"freq":"none"}' ? "" : "r"}`;
        return exclusive(async () => {
          // Read again in turn: the calendar may have been changed or removed while it downloaded.
          const feed = await read<Feed>("feeds", id);
          if (!feed) return fail("Calendar not found", 404);
          const imported = parsed.map((item) => ({ ...item, kind: feed.importKind ?? item.kind, color: feed.useColor ? feed.color : null }));
          const prior = (await list<Item>("items")).filter((item) => item.source === `feed:${id}`);
          const byUid = new Map(prior.map((item) => [keyOf(item), item]));
          const seen = new Set<number>();
          for (const fresh of imported) {
            const old = byUid.get(keyOf(fresh));
            if (old) {
              seen.add(old.id);
              // Kinds changed on the item stay unless "Import items as" was changed since.
              const kind = (feed.resetKinds ? fresh.kind : undefined) ?? old.kind;
              const saved = await put("items", { ...old, ...fresh, id: old.id, kind, journalOff: old.journalOff,
                // A color picked in Cadence stays, unless the calendar's color setting was changed since.
                color: feed.resetColors ? fresh.color : old.color,
                // So does a task's own tag, unless the calendar's tag was changed since.
                tags: feed.resetTags ? tagsFor(feed, kind) : old.tags,
                // Dates the calendar skips, plus any taken off in Cadence.
                completions: old.completions, exceptions: JSON.stringify([...new Set([...listOf(old.exceptions), ...listOf(fresh.exceptions)])]), reminder: old.reminder, extraReminders: old.extraReminders, priority: old.priority,
                autoTimer: old.autoTimer, ...(old.kind === "task" && (old.availableFrom || old.leadDays) ? {
                  availableFrom: old.availableFrom, leadDays: old.leadDays ?? null, endDate: null, allDay: false,
                } : {}) });
              await syncNotes(saved, (fresh.notes || "").trim() !== (old.notes || "").trim());
            } else await syncNotes(await put("items", { ...fresh, journalOff: !feed.journalNotes, tags: tagsFor(feed, fresh.kind) }) as Item, true);
          }
          for (const old of prior) if (!seen.has(old.id)) await removeItem(old);
          return ok(await put("feeds", { ...feed, resetKinds: false, resetColors: false, resetTags: false,
            etag: fetched.etag ?? null, lastModified: fetched.lastModified ?? null, fingerprint, lastSynced: new Date().toISOString(), eventCount: imported.length, lastError: null }));
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Unable to read calendar";
        await exclusive(async () => {
          const current = await read<Feed>("feeds", id);
          if (current) await put("feeds", { ...current, lastError: message });
        });
        return fail(message, 502);
      }
    }
  }
  if (path === "/api/import" && method === "POST") {
    try {
      if (data.importKind && !IMPORT_KINDS.includes(data.importKind)) return fail("Choose a valid import type");
      const { items: rows, skipped } = parseAndroidIcs(data.ics, data.tz || Intl.DateTimeFormat().resolvedOptions().timeZone, "import");
      await exclusive(async () => { for (const item of rows) await syncNotes(await put("items", {
        ...item, kind: data.importKind || item.kind, journalOff: !data.journalNotes,
      }) as Item, true); });
      return ok({ imported: rows.length, skipped });
    } catch (cause) { return fail("Couldn't read calendar: " + String(cause instanceof Error ? cause.message : cause)); }
  }
  if (path === "/api/sessions" && method === "GET") return ok(await list<Session>("sessions"));
  if (path === "/api/sessions" && method === "POST") {
    if (!validDate(data.date) || typeof data.title !== "string" || !Number.isFinite(data.actualSec)) return fail("Invalid focus session");
    const { id: _id, ...session } = data;
    return ok(await put("sessions", session));
  }
  const sessionRoute = /^\/api\/sessions\/(\d+)$/.exec(path);
  // A session saved to the calendar is deleted with its calendar item (and that item's journal entry).
  if (sessionRoute && method === "DELETE") return exclusive(async () => {
    const session = await read<Session>("sessions", Number(sessionRoute[1]));
    const item = session?.calendarItemId ? await read<Item>("items", session.calendarItemId) : undefined;
    if (item) await removeItem(item);
    await remove("sessions", Number(sessionRoute[1]));
    return ok({ ok: true });
  });
  if (sessionRoute && method === "PATCH") return exclusive(async () => {
    const session = await read<Session>("sessions", Number(sessionRoute[1]));
    if (!session) return fail("Not found", 404);
    const calendarItemId = Number.isSafeInteger(data.calendarItemId) ? data.calendarItemId : null;
    return ok(await put("sessions", { ...session, calendarItemId }));
  });
  if (path === "/api/journal" && method === "GET") {
    await (notesBackfilled ??= backfillNotes().catch(() => {}));
    await exclusive(archiveFinished).catch(() => {});
    return ok((await list<JournalEntry>("journal")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  // Renames a journal tag (to) or removes it (to: null) on every entry, in its tags and its #hashtags.
  // A removed hashtag keeps its word. Entries holding an item's notes pass the new text to the item.
  if (path === "/api/journal/retag" && method === "POST") return exclusive(async () => {
    const from = String(data.from || "").toLowerCase(), to = data.to ? String(data.to).toLowerCase() : null;
    if (!from) return fail("Choose a tag");
    const hashtag = new RegExp(`(^|\\s)#${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_-])`, "giu");
    for (const entry of await list<JournalEntry>("journal")) {
      const tags = listOf(entry.tags);
      if (!tags.includes(from)) continue;
      // With tags from the text turned off, its #words aren't this tag, so the text stays as it is.
      const useHashtags = entry.hashtags !== false;
      const body = useHashtags ? entry.body.replace(hashtag, to ? `$1#${to}` : `$1${from}`) : entry.body;
      const kept = tags.filter((t) => t !== from && !(useHashtags && hashtagsIn(entry.body).includes(t)));
      await put("journal", { ...entry, body, tags: normTags(body, to ? [...kept, to] : kept, useHashtags), updatedAt: new Date().toISOString() });
      const item = entry.itemId ? await read<Item>("items", entry.itemId) : undefined;
      if (item && body !== entry.body) await put("items", { ...item, notes: body });
    }
    return ok({ ok: true });
  });
  if (path === "/api/journal" && method === "POST") {
    if (!validDate(data.date) || !data.body?.trim()) return fail("Date and body required");
    const now = new Date().toISOString();
    return ok(await put("journal", {
      date: data.date, title: entryTitle(data.title), body: data.body.trim(), hashtags: data.hashtags !== false,
      tags: normTags(data.body, data.tags, data.hashtags !== false),
      createdAt: now, updatedAt: now,
    }));
  }
  const journalRoute = /^\/api\/journal\/(\d+)$/.exec(path);
  if (journalRoute) return exclusive(async () => {
    const id = Number(journalRoute[1]), entry = await read<JournalEntry>("journal", id);
    if (!entry) return fail("Not found", 404);
    const item = entry.itemId ? await read<Item>("items", entry.itemId) : undefined;
    if (method === "DELETE") {
      await remove("journal", id);
      if (item) await put("items", { ...item, journalId: null, journalOff: true });
      return ok({ ok: true });
    }
    if (method === "PATCH") {
      const next = {
        ...entry, ...data, id: entry.id, itemId: entry.itemId, archivedAuto: entry.archivedAuto,
        archived: data.archived !== undefined ? !!data.archived : !!entry.archived,
        title: data.title !== undefined ? entryTitle(data.title) : entry.title ?? null,
        body: typeof data.body === "string" ? data.body.trim() : entry.body,
        hashtags: data.hashtags !== undefined ? data.hashtags !== false : entry.hashtags !== false,
        tags: data.body !== undefined || data.tags || data.hashtags !== undefined
          ? normTags(data.body ?? entry.body, data.tags ?? JSON.parse(entry.tags), (data.hashtags ?? entry.hashtags) !== false) : entry.tags,
      };
      // Only a change to what it says marks it edited (saving it unchanged, or archiving it, doesn't).
      const changed = next.title !== (entry.title ?? null) || next.body !== entry.body || next.tags !== entry.tags ||
        next.hashtags !== (entry.hashtags !== false) || next.date !== entry.date;
      const saved = await put("journal", { ...next, updatedAt: changed ? new Date().toISOString() : entry.updatedAt });
      // Editing the entry edits the item's notes.
      if (item && saved.body && saved.body !== item.notes) await put("items", { ...item, notes: saved.body });
      return ok(saved);
    }
    return fail("Unsupported action", 405);
  });
  return fail("This feature isn't available offline", 501);
}

export function installAndroidApi() {
  if (!window.CadenceAndroid) return;
  const networkFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return networkFetch(input, init);
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    try {
      if (url.pathname === "/api/backup/restore" && String(init?.body || "").length > 26 * 1024 * 1024) {
        return fail("Backup exceeds 25 MB", 413);
      }
      const data = await bodyJSON(init?.body);
      if (url.pathname === "/api/export.ics") {
        const includeFeeds = url.searchParams.get("feeds") === "1";
        const items = (await list<Item>("items")).filter((item) => includeFeeds || !item.source.startsWith("feed:"));
        return new Response(exportAndroidIcs(items, Intl.DateTimeFormat().resolvedOptions().timeZone), {
          headers: { "Content-Type": "text/calendar; charset=utf-8" },
        });
      }
      const response = await localApi(method, url.pathname, data);
      // Journal changes only touch the journal widget; the rest can change reminders too.
      if (response.ok && method !== "GET") {
        if (url.pathname.startsWith("/api/journal")) queueRefresh(false);
        else if (url.pathname.startsWith("/api/items") || url.pathname.startsWith("/api/feeds") ||
          url.pathname === "/api/import" || url.pathname === "/api/settings") queueRefresh(true);
      }
      return response;
    } catch (cause) {
      return fail(cause instanceof Error ? cause.message : "Local database unavailable", 500);
    }
  };
  void dbReady.then(applyWidgetActions).then(() => refreshNotifications(true)).catch(() => {});
  // Android pokes the app when a widget is tapped while it's running.
  window.addEventListener("cadence-widget-actions", () => { void applyWidgetActions().then(() => refreshNotifications(true)).catch(() => {}); });
}

/**
 * Replays task and habit taps made on the home screen widgets. Both are flips (toggle done, or
 * cycle a habit through half and done), so replaying them in order gives the state the widget showed.
 */
async function applyWidgetActions() {
  let actions: { op?: string; id?: number; date?: string }[] = [];
  try { actions = JSON.parse(window.CadenceAndroid?.takeWidgetActions?.() || "[]"); } catch { return; }
  if (!Array.isArray(actions) || !actions.length) return;
  for (const action of actions) {
    if ((action.op === "toggle" || action.op === "cycle") && Number.isInteger(action.id) && typeof action.date === "string") {
      await localApi("POST", `/api/items/${action.id}/${action.op}`, { date: action.date }).catch(() => {});
    }
  }
  await queryClient.invalidateQueries({ queryKey: ["/api/items"] });
}
