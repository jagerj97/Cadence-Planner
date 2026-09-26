import { DEFAULT_SETTINGS, IMPORT_KINDS } from "@shared/schema";
import { KIND_TAGS, type Feed, type InsertItem, type Item, type JournalEntry, type Session, type Settings } from "@shared/schema";
import { exportAndroidIcs, parseAndroidIcs } from "./androidIcs";
import { widgetSnapshot } from "./widget";
import { queryClient } from "./queryClient";
import { addDays, blocksForDay, fmtDur, parseYmd, remindersOf, todayStr } from "./cal";

export interface AndroidBridge {
  setAppearance?(mode: "light" | "dark"): void;
  requestLocation?(): void;
  haptic?(kind: string): void;
  fetchCalendar(url: string): string;
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
const pref = async (): Promise<Settings> => {
  const saved = (await read<{ key: string; value: Settings }>("settings", "prefs"))?.value;
  return { ...DEFAULT_SETTINGS, ...saved };
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
      !validTime(it.startTime) || !validTime(it.endTime)) return false;
  if (it.availableFrom && (it.kind !== "task" || !validDate(it.availableFrom) || it.availableFrom > it.date ||
      it.startTime || it.endTime || it.allDay || JSON.parse(it.recurrence || '{"freq":"none"}').freq !== "none")) return false;
  return true;
}
const normTags = (body: string, tags: unknown) => {
  const found = new Set<string>();
  for (const match of body.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)) found.add(match[2].toLowerCase());
  if (Array.isArray(tags)) for (const tag of tags) {
    if (typeof tag === "string" && tag.trim()) found.add(tag.trim().replace(/^#/, "").toLowerCase());
  }
  return JSON.stringify([...found]);
};
/**
 * An item's notes live on as a journal entry on the day the item begins, tagged with its kind
 * (#events, #meetings...), except for habits. Saving the item keeps the entry's text, date and tag current, clearing
 * the notes removes it, and editing the entry in the journal edits the notes. An entry deleted
 * from the journal comes back only when the notes are changed again.
 */
const kindTags = new Set(Object.values(KIND_TAGS));
async function syncNotes(item: Item, notesChanged: boolean): Promise<Item> {
  // Habits keep their notes to themselves; an item that becomes a habit gives up its entry.
  const notes = item.kind === "habit" ? "" : (item.notes || "").trim();
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
/** Items saved before notes became journal entries get theirs once. */
const backfillNotes = () => exclusive(async () => {
  for (const item of await list<Item>("items")) {
    if (item.journalId === undefined && item.source === "local" && item.notes?.trim()) await syncNotes(item, true);
  }
});
let notesBackfilled: Promise<void> | null = null;

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

async function refreshNotifications() {
  const bridge = window.CadenceAndroid;
  if (!bridge?.scheduleReminders) return;
  const items = await list<Item>("items");
  try {
    bridge.updateWidget?.(JSON.stringify(widgetSnapshot(items, await pref())));
  } catch { /* the widget is optional */ }
  const reminders: { at: number; title: string; body: string }[] = [];
  const now = Date.now();
  for (let offset = -1; offset < 32; offset++) {
    const date = addDays(todayStr(), offset);
    for (const block of blocksForDay(items, date)) {
      const item = block.item;
      if (block.continues === "before" || !item.startTime || item.kind === "sleep") continue;
      for (const minutes of remindersOf(item)) {
        const at = parseYmd(date).getTime() + (block.start - minutes) * 60000;
        if (at <= now || at > now + 31 * 86400000) continue;
        reminders.push({
          at,
          title: `${item.kind[0].toUpperCase()}${item.kind.slice(1)}: ${item.title}`,
          body: minutes === 0 ? "Starting now" : `Starts in ${fmtDur(minutes)}`,
        });
      }
    }
  }
  reminders.sort((a, b) => a.at - b.at);
  bridge.scheduleReminders(JSON.stringify(reminders.slice(0, 128)));
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
      if (store === "settings" && (
        !record(entry.value) || !Array.isArray(entry.value.routines) ||
        !Array.isArray(entry.value.habitOrder) ||
        (entry.value.appearanceTheme !== undefined && !["light", "dark"].includes(entry.value.appearanceTheme)) ||
        !["tomato", "orange", "blueberry", "plum", "avocado", "monochrome"].includes(entry.value.colorTheme) ||
        entry.value.routines.some((routine: unknown) => !record(routine) ||
          typeof routine.name !== "string" || !routine.name.trim() ||
          typeof routine.startTime !== "string" || typeof routine.endTime !== "string" ||
          !validTime(routine.startTime) || !validTime(routine.endTime) ||
          routine.startTime === routine.endTime)
      )) throw new Error("Invalid settings in backup");
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
  await refreshNotifications().catch(() => {});
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
      return fail("Could not restore this backup. Your existing data was not changed.", 500);
    }
  }
  if (path === "/api/items" && method === "GET") return ok(await list<Item>("items"));
  if (path === "/api/items" && method === "POST") {
    if (!validItem(data)) return fail("Enter a valid title, date and time");
    const { journalId: _, ...fresh } = data;
    return exclusive(async () => ok(await syncNotes(await put("items", fresh), true)));
  }
  const itemRoute = /^\/api\/items\/(\d+)(?:\/(toggle|cycle|skip))?$/.exec(path);
  if (itemRoute) return exclusive(async () => {
    const id = Number(itemRoute[1]), item = await read<Item>("items", id);
    if (!item) return fail("Not found", 404);
    if (method === "DELETE" && !itemRoute[2]) {
      // The notes stay in the journal as a plain entry.
      const entry = item.journalId ? await read<JournalEntry>("journal", item.journalId) : undefined;
      if (entry) await put("journal", { ...entry, itemId: null });
      await remove("items", id);
      return ok({ ok: true });
    }
    if (method === "PATCH" && !itemRoute[2]) {
      const merged = { ...item, ...data, journalId: item.journalId, ...(item.source.startsWith("feed:") && data.kind && data.kind !== item.kind ? { color: null } : {}) };
      if (!validItem(merged)) return fail("Enter a valid title, date and time");
      const notesChanged = typeof data.notes === "string" && data.notes.trim() !== (item.notes || "").trim() ||
        item.kind === "habit" && merged.kind !== "habit";
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
    const next = { ...await pref(), ...data };
    if (!Array.isArray(next.routines) || !Array.isArray(next.habitOrder) || !Array.isArray(next.hiddenTodayPanels) || !Array.isArray(next.todayPanelOrder) ||
        !["light", "dark"].includes(next.appearanceTheme) ||
        !["tomato", "orange", "blueberry", "plum", "avocado", "monochrome"].includes(next.colorTheme) ||
        next.routines.some((r: any) => !r.name?.trim() || !validTime(r.startTime) || !validTime(r.endTime) || r.startTime === r.endTime)) {
      return fail("Check routine settings, theme and habit order");
    }
    await put("settings", { key: "prefs", value: next });
    return ok(next);
  }
  if (path === "/api/feeds" && method === "GET") return ok(await list<Feed>("feeds"));
  if (path === "/api/feeds" && method === "POST") {
    try {
      if (!data.name?.trim() || data.importKind && !IMPORT_KINDS.includes(data.importKind)) return fail("Choose a valid name and import type");
      return ok(await put("feeds", {
        name: data.name.trim(), url: normalizedUrl(data.url), color: data.color || "#4f6bd8",
        importKind: data.importKind || null, lastSynced: null, eventCount: 0, lastError: null,
      }));
    } catch { return fail("Enter a valid calendar URL"); }
  }
  const feedRoute = /^\/api\/feeds\/(\d+)(?:\/sync)?$/.exec(path);
  if (feedRoute) {
    const id = Number(feedRoute[1]);
    if (method === "DELETE") return exclusive(async () => {
      await remove("feeds", id);
      for (const item of await list<Item>("items")) if (item.source === `feed:${id}`) await remove("items", item.id);
      return ok({ ok: true });
    });
    if (method === "POST" && path.endsWith("/sync")) {
      const feed = await read<Feed>("feeds", id);
      if (!feed) return fail("Calendar not found", 404);
      try {
        const fetched = JSON.parse(window.CadenceAndroid!.fetchCalendar(feed.url));
        if (fetched.error) throw new Error(fetched.error);
        const imported = parseAndroidIcs(fetched.text, data.tz || Intl.DateTimeFormat().resolvedOptions().timeZone, `feed:${id}`, "expand")
          .map((item) => ({ ...item, kind: feed.importKind ?? item.kind, color: feed.importKind ? null : feed.color }));
        return exclusive(async () => {
          const prior = (await list<Item>("items")).filter((item) => item.source === `feed:${id}`);
          const byUid = new Map(prior.map((item) => [`${item.uid || item.title}\0${item.date}`, item]));
          const seen = new Set<number>();
          for (const fresh of imported) {
            const old = byUid.get(`${fresh.uid || fresh.title}\0${fresh.date}`);
            if (old) {
              seen.add(old.id);
              await put("items", { ...old, ...fresh, id: old.id, kind: old.kind, color: old.color,
                completions: old.completions, exceptions: old.exceptions, reminder: old.reminder, extraReminders: old.extraReminders, priority: old.priority,
                autoTimer: old.autoTimer, ...(old.kind === "task" && old.availableFrom ? {
                  availableFrom: old.availableFrom, startTime: null, endTime: null, endDate: null, allDay: false,
                } : {}) });
            } else await put("items", fresh);
          }
          for (const old of prior) if (!seen.has(old.id)) await remove("items", old.id);
          return ok(await put("feeds", { ...feed, lastSynced: new Date().toISOString(), eventCount: imported.length, lastError: null }));
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Unable to read calendar";
        await put("feeds", { ...feed, lastError: message });
        return fail(message, 502);
      }
    }
  }
  if (path === "/api/import" && method === "POST") {
    try {
      if (data.importKind && !IMPORT_KINDS.includes(data.importKind)) return fail("Choose a valid import type");
      const rows = parseAndroidIcs(data.ics, data.tz || Intl.DateTimeFormat().resolvedOptions().timeZone, "import", "map");
      await exclusive(async () => { for (const item of rows) await put("items", {
        ...item, kind: data.importKind || item.kind,
      }); });
      return ok({ imported: rows.length });
    } catch (cause) { return fail("Couldn't read calendar: " + String(cause instanceof Error ? cause.message : cause)); }
  }
  if (path === "/api/export.ics" && method === "GET") {
    const includeFeeds = new URLSearchParams(location.search).get("feeds") === "1";
    const items = (await list<Item>("items")).filter((item) => includeFeeds || !item.source.startsWith("feed:"));
    return new Response(exportAndroidIcs(items, Intl.DateTimeFormat().resolvedOptions().timeZone), {
      headers: { "Content-Type": "text/calendar; charset=utf-8" },
    });
  }
  if (path === "/api/sessions" && method === "GET") return ok(await list<Session>("sessions"));
  if (path === "/api/sessions" && method === "POST") return ok(await put("sessions", data));
  if (path === "/api/journal" && method === "GET") {
    await (notesBackfilled ??= backfillNotes().catch(() => {}));
    return ok((await list<JournalEntry>("journal")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  if (path === "/api/journal" && method === "POST") {
    if (!validDate(data.date) || !data.body?.trim()) return fail("Date and body required");
    const now = new Date().toISOString();
    return ok(await put("journal", {
      date: data.date, body: data.body.trim(), tags: normTags(data.body, data.tags),
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
      if (item) await put("items", { ...item, journalId: null });
      return ok({ ok: true });
    }
    if (method === "PATCH") {
      const saved = await put("journal", {
        ...entry, ...data, itemId: entry.itemId,
        body: typeof data.body === "string" ? data.body.trim() : entry.body,
        tags: data.body !== undefined || data.tags ? normTags(data.body ?? "", data.tags ?? JSON.parse(entry.tags)) : entry.tags,
        updatedAt: new Date().toISOString(),
      });
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
      if (response.ok && method !== "GET" && (
        url.pathname.startsWith("/api/items") || url.pathname.startsWith("/api/feeds") ||
        url.pathname === "/api/import" || url.pathname === "/api/settings"
      )) await refreshNotifications();
      return response;
    } catch (cause) {
      return fail(cause instanceof Error ? cause.message : "Local database unavailable", 500);
    }
  };
  void dbReady.then(applyWidgetActions).then(refreshNotifications).catch(() => {});
  // Android pokes the app when a widget is tapped while it's running.
  window.addEventListener("cadence-widget-actions", () => { void applyWidgetActions().then(refreshNotifications).catch(() => {}); });
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
