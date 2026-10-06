import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DisplayMode, Item, InsertItem, Kind, Recurrence, Session } from "@shared/schema";
import { DEFAULT_SETTINGS, KINDS } from "@shared/schema";
import { useForm } from "react-hook-form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { blankItem, useItemMutations, useItems, useSettings } from "@/lib/data";
import {
  KIND_META,
  addDays,
  dueDateFor,
  isDeadlineTask,
  blocksForDay,
  dayDiff,
  dow,
  fmtDur,
  fmtDate,
  fmtTime,
  fromMin,
  kindOf,
  listOf,
  colorOf,
  completionsOf,
  fillOf,
  markOf,
  occursOn,
  recLabel,
  recOf,
  remindersOf,
  toMin,
  todayStr,
  ymd,
  isTimed,
  shiftedToToday,
  sunTimes,
} from "@/lib/cal";
import { cn } from "@/lib/utils";
import { WeekdayPills, choicePill } from "@/components/pills";
import { TwoRows } from "@/components/twoRows";
import { Linked, LocationLink } from "@/components/links";
import { WhatsNew } from "@/components/whatsNew";
import { TAG_COLORS, TagChip, TaskTagField, itemTags, taskColor, taskTagsOf } from "@/components/taskTags";
import { AlignLeft, Bell, CalendarClock, Check, Clock, Flag, Flame, Hash, Link2, MapPin, Palette, Plus, Repeat, Timer, Trash2, X } from "lucide-react";

/* ============ sound ============ */
let audioCtx: AudioContext | null = null;
/**
 * The soft chime for reminders and a finished timer, in a browser. In the Android app the phone's
 * notification plays the sound instead (on the notification volume: the jingle, or this chime with
 * Cadence outside), so this does nothing there.
 */
export function chime(kind: "soft" | "done" = "soft") {
  if (window.CadenceAndroid) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = kind === "done" ? [660, 880, 1100] : [880, 660];
    notes.forEach((f, i) => {
      const o = audioCtx!.createOscillator();
      const g = audioCtx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = audioCtx!.currentTime + i * 0.18;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(audioCtx!.destination);
      o.start(t);
      o.stop(t + 0.65);
    });
  } catch {
    /* audio unavailable */
  }
}

/* ============ theme ============ */
type Theme = "light" | "dark";

/** Whether the phone is in dark mode (the app asks Android; a browser, its own setting). */
function readSystemDark() {
  const bridge = window.CadenceAndroid;
  if (bridge?.systemDark) {
    try { return bridge.systemDark(); } catch { /* fall back below */ }
  }
  return !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

/** Sunrise/sunset: dark before sunrise and from sunset, at the location in Settings. */
function sunIsDown(now: Date, lat: number, lng: number) {
  const sun = sunTimes(ymd(now), lat, lng);
  if (sun.polar) return sun.polar === "night";
  const m = now.getHours() * 60 + now.getMinutes();
  return m < sun.sunrise || m >= sun.sunset;
}

/** Switches the page to light or dark, cross-fading the whole page when `fade` (and the WebView can). */
function applyTheme(theme: Theme, fade: boolean) {
  const root = document.documentElement;
  const set = () => root.classList.toggle("dark", theme === "dark");
  const doc = document as Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };
  if (!fade || root.classList.contains("dark") === (theme === "dark") || !doc.startViewTransition ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    set();
    return;
  }
  root.classList.add("theme-fading");
  doc.startViewTransition(set).finished.finally(() => root.classList.remove("theme-fading"));
}

/* ============ focus timer ============ */
export type FocusState = {
  itemId: number | null;
  title: string;
  mode: "focus"; // older saves may say "break", from before breaks were removed
  plannedSec: number;
  accSec: number; // accumulated before current run
  runStart: number | null; // ms timestamp when running
  startedAt: string;
};

type Ctx = {
  theme: Theme;
  /** Applies a Display mode straight away (Settings saves it too). */
  setDisplayMode: (mode: DisplayMode) => void;
  /** onCreated runs after a new item is saved (not when the window is closed without saving). */
  openEditor: (target: Item | Partial<InsertItem>, occDate?: string, onCreated?: (item: Item) => void) => void;
  openDetails: (target: Item, occDate?: string) => void;
  focus: FocusState | null;
  startFocus: (opts: { title: string; itemId?: number | null; minutes: number }) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  stopFocus: (completed?: boolean) => void;
  addFocusTime: (min: number) => void;
  /** Asks whether a change to a repeating item applies to just the one opened or the whole series. */
  askRepeatScope: () => Promise<RepeatScope | null>;
};
type RepeatScope = "one" | "all";
const PlannerCtx = createContext<Ctx | null>(null);

/** Seconds a focus session has run, counting the current run. */
export const focusElapsed = (f: FocusState) => f.accSec + (f.runStart ? (Date.now() - f.runStart) / 1000 : 0);

/** The running focus session's seconds so far, ticking twice a second (only where it's shown). */
export function useFocusElapsed() {
  const { focus } = usePlanner();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!focus?.runStart) return;
    const t = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [focus?.runStart]);
  return focus ? focusElapsed(focus) : 0;
}
export const usePlanner = () => {
  const c = useContext(PlannerCtx);
  if (!c) throw new Error("PlannerProvider missing");
  return c;
};

/**
 * Saves changes to an item. A repeating item (other than a habit, which always changes as a whole)
 * opened on a given day asks "Just this one" or "All of them" first. Just this one skips that day in
 * the series and saves a one-off copy with the changes, keeping that day's check-off. Resolves to
 * the scope that was saved, or null if the question was dismissed.
 */
export function useSaveItem() {
  const { askRepeatScope } = usePlanner();
  const { create, update, skip } = useItemMutations();
  const saveOne = async (series: Item, occDate: string, changes: Partial<InsertItem>) => {
    const { id: _id, journalId: _journal, ...rest } = series;
    // The form shows the series' first day; a changed date moves this one there.
    const date = changes.date && changes.date !== series.date ? changes.date : occDate;
    const span = dayDiff(changes.date ?? series.date, changes.endDate ?? series.endDate ?? series.date);
    const marks = listOf(series.completions).filter((c) => c === occDate || c === occDate + "~h");
    await skip.mutateAsync({ id: series.id, date: occDate });
    await create.mutateAsync(blankItem({
      ...rest, ...changes, date, endDate: addDays(date, Math.max(0, span)),
      recurrence: '{"freq":"none"}', exceptions: "[]", uid: null, source: "local",
      completions: JSON.stringify(marks.map((c) => c.replace(occDate, date))),
      // The series already keeps these notes in the journal.
      journalOff: (changes.notes ?? series.notes).trim() === series.notes.trim() ? true : undefined,
    }));
  };
  return async (item: Item, changes: Partial<InsertItem>, occDate?: string): Promise<RepeatScope | null> => {
    if (occDate && recOf(item).freq !== "none" && item.kind !== "habit" && (changes.kind ?? item.kind) !== "habit") {
      const scope = await askRepeatScope();
      if (scope === "one") await saveOne(item, occDate, changes);
      if (scope === "all") await update.mutateAsync({ id: item.id, ...changes });
      return scope;
    }
    await update.mutateAsync({ id: item.id, ...changes });
    return "all";
  };
}

export function PlannerProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const { settings, data: savedSettings } = useSettings();
  // Display mode: dark (the default until saved settings say otherwise), light, the phone's setting,
  // or light between sunrise and sunset. Settings changes it straight away with setDisplayMode.
  const [mode, setDisplayMode] = useState<DisplayMode>("dark");
  const [themeLoaded, setThemeLoaded] = useState(false);
  useEffect(() => {
    if (!savedSettings) return;
    setDisplayMode(savedSettings.displayMode ?? savedSettings.appearanceTheme ?? "dark");
    setThemeLoaded(true);
  }, [savedSettings?.displayMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const [systemDark, setSystemDark] = useState(readSystemDark);
  useEffect(() => {
    if (mode !== "system") return;
    const sync = () => setSystemDark(readSystemDark());
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    sync();
    query?.addEventListener?.("change", sync);
    window.addEventListener("cadence-ui-mode", sync); // the phone's dark mode changed (AppActivity)
    document.addEventListener("visibilitychange", sync);
    return () => {
      query?.removeEventListener?.("change", sync);
      window.removeEventListener("cadence-ui-mode", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [mode]);
  // Sunrise/sunset looks at the clock every half minute, and when the app comes back.
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    if (mode !== "sun") return;
    const tick = () => setClock(new Date());
    const t = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [mode]);
  const theme: Theme = mode === "light" ? "light" : mode === "dark" ? "dark"
    : mode === "system" ? (systemDark ? "dark" : "light")
    : sunIsDown(clock, settings.lat, settings.lng) ? "dark" : "light";
  // Changes the app makes on its own (sunrise, sunset, the phone switching) fade across; picking a
  // mode in Settings switches at once.
  const lastLook = useRef<{ theme: Theme; mode: DisplayMode } | null>(null);
  useEffect(() => {
    const last = lastLook.current;
    lastLook.current = { theme, mode };
    applyTheme(theme, themeLoaded && !!last && last.mode === mode && last.theme !== theme);
    if (themeLoaded) window.CadenceAndroid?.setAppearance?.(theme);
  }, [theme, mode, themeLoaded]);
  useEffect(() => {
    document.documentElement.dataset.colorTheme = settings.colorTheme || DEFAULT_SETTINGS.colorTheme;
  }, [settings.colorTheme]);
  // "Play a sound" decides whether the phone's notifications (which make the sounds) are silent.
  useEffect(() => {
    if (savedSettings) window.CadenceAndroid?.setSound?.(savedSettings.sound !== false);
  }, [savedSettings?.sound]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Let Cadence outside" also swaps the app and notification icons. Flipping it in Settings does that
  // (and closes the app); this keeps them matched to the saved setting on start, e.g. after a restore.
  const iconsSynced = useRef(false);
  useEffect(() => {
    if (!savedSettings || iconsSynced.current) return;
    iconsSynced.current = true;
    window.CadenceAndroid?.setPlain?.(!!savedSettings.plain);
  }, [savedSettings]);

  /* editor */
  const [editing, setEditing] = useState<Editing | null>(null);
  const [details, setDetails] = useState<{ target: Item; occDate?: string } | null>(null);
  const openEditor = useCallback((target: Item | Partial<InsertItem>, occDate?: string, onCreated?: (item: Item) => void) =>
    setEditing({ target, occDate, onCreated }), []);
  const openDetails = useCallback((target: Item, occDate?: string) => setDetails({ target, occDate }), []);
  const [scopeAsk, setScopeAsk] = useState<{ resolve: (scope: RepeatScope | null) => void } | null>(null);
  const askRepeatScope = useCallback(() => new Promise<RepeatScope | null>((resolve) => setScopeAsk({ resolve })), []);
  const answerScope = (scope: RepeatScope | null) => {
    scopeAsk?.resolve(scope);
    setScopeAsk(null);
  };

  /* focus */
  const [focus, setFocus] = useState<FocusState | null>(() => {
    if (!window.CadenceAndroid) return null;
    try { return JSON.parse(window.CadenceAndroid.getFocus() || "null"); }
    catch { return null; }
  });
  useEffect(() => {
    if (!window.CadenceAndroid) return;
    window.CadenceAndroid.saveFocus(JSON.stringify(focus));
    if (focus?.runStart) {
      const remaining = Math.max(0, focus.plannedSec - focus.accSec) * 1000;
      window.CadenceAndroid.scheduleFocus(focus.runStart + remaining, "Focus session complete", focus.title);
    } else window.CadenceAndroid.cancelFocus();
  }, [focus]);

  const logSession = useCallback(async (f: FocusState, sec: number, completed: boolean): Promise<Session | null> => {
    if (sec < 30) return null;
    try {
      const saved = await apiRequest("POST", "/api/sessions", {
        itemId: f.itemId,
        title: f.title,
        date: todayStr(),
        startedAt: f.startedAt,
        plannedMin: Math.round(f.plannedSec / 60),
        actualSec: Math.round(sec),
        completed,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      return (await saved.json()) as Session;
    } catch {
      return null;
    }
  }, []);

  // After a session of more than 5 minutes, offer to put it on the calendar as a focus item. Not for
  // one started from something already on the calendar at a set time.
  const [calendarOffer, setCalendarOffer] = useState<{ title: string; start: Date; end: Date; session: Promise<Session | null> } | null>(null);
  const offerCalendar = useCallback((f: FocusState, sec: number, endMs: number, session: Promise<Session | null>) => {
    if (sec <= 300) return;
    const from = f.itemId != null ? queryClient.getQueryData<Item[]>(["/api/items"])?.find((i) => i.id === f.itemId) : undefined;
    if (from && isTimed(from)) return;
    setCalendarOffer({ title: f.title === "Focus session" ? "" : f.title, start: new Date(f.startedAt), end: new Date(endMs), session });
  }, []);
  const saveOfferToCalendar = () => {
    if (!calendarOffer) return;
    const { title, start, end, session } = calendarOffer;
    const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    setCalendarOffer(null);
    // The session and its calendar item are linked, so deleting either deletes both.
    openEditor({ kind: "focus", title, date: ymd(start), endDate: ymd(end), startTime: hm(start), endTime: hm(end), reminder: null },
      undefined, async (item) => {
        const saved = await session;
        if (saved) await apiRequest("PATCH", `/api/sessions/${saved.id}`, { calendarItemId: item.id }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      });
  };

  const startFocus: Ctx["startFocus"] = useCallback(
    ({ title, itemId = null, minutes }) => {
      setFocus((prev) => {
        if (prev) {
          const sec = prev.accSec + (prev.runStart ? (Date.now() - prev.runStart) / 1000 : 0);
          logSession(prev, sec, false);
        }
        return {
          itemId,
          title,
          mode: "focus",
          plannedSec: Math.max(1, minutes) * 60,
          accSec: 0,
          runStart: Date.now(),
          startedAt: new Date().toISOString(),
        };
      });
    },
    [logSession],
  );
  const pauseFocus = useCallback(() =>
    setFocus((f) => (f && f.runStart ? { ...f, accSec: f.accSec + (Date.now() - f.runStart) / 1000, runStart: null } : f)), []);
  const resumeFocus = useCallback(() => setFocus((f) => (f && !f.runStart ? { ...f, runStart: Date.now() } : f)), []);
  const stopFocus = useCallback((completed = false) => {
    if (focus) {
      const elapsed = focusElapsed(focus);
      const saved = logSession(focus, elapsed, completed);
      if (completed) offerCalendar(focus, elapsed, Date.now(), saved);
    }
    setFocus(null);
  }, [focus, logSession, offerCalendar]);
  const addFocusTime = useCallback((min: number) => setFocus((f) => (f ? { ...f, plannedSec: f.plannedSec + min * 60 } : f)), []);

  // A widget's + button opens the app to add a task, habit, event or journal entry; tapping a widget opens its page.
  useEffect(() => {
    const run = () => {
      const action = window.CadenceAndroid?.takeLaunchAction?.() || "";
      if (action === "add-task") openEditor({ date: todayStr(), kind: "task" });
      if (action === "add-habit") openEditor({ date: todayStr(), kind: "habit", recurrence: '{"freq":"daily"}' });
      if (action === "add-event") openEditor({ date: todayStr(), kind: "event" });
      // The journal widget's +: the journal, with a new entry open.
      if (action === "add-journal") {
        window.location.hash = "#/journal";
        requestJournalCompose();
      }
      // Each widget opens its own page ("open:/tasks").
      if (/^open:\/[a-z]*$/.test(action)) window.location.hash = `#${action.slice(5)}`;
    };
    run();
    window.addEventListener("cadence-launch-action", run);
    return () => window.removeEventListener("cadence-launch-action", run);
  }, [openEditor]);

  // The Android timer notification can pause, resume, or stop the timer while the app is closed.
  // Reload the saved timer when it does, or when the app comes back, and log any session it stopped.
  useEffect(() => {
    const bridge = window.CadenceAndroid;
    if (!bridge) return;
    const sync = () => {
      try {
        const stopped: (FocusState & { stoppedAt?: number }) | null = JSON.parse(bridge.takeFocusStop?.() || "null");
        // The notification's Finish logs the session like the app's Finish button.
        if (stopped) {
          const saved = logSession(stopped, stopped.accSec, true);
          // The notification's Finish opens the app and says when it stopped (older builds didn't: then it
          // ended about its focused time after it began).
          offerCalendar(stopped, stopped.accSec, stopped.stoppedAt ?? Date.parse(stopped.startedAt) + stopped.accSec * 1000, saved);
        }
      } catch { /* ignore */ }
      try {
        const saved: FocusState | null = JSON.parse(bridge.getFocus() || "null");
        setFocus((current) => (JSON.stringify(current) === JSON.stringify(saved) ? current : saved));
      } catch { /* ignore */ }
    };
    const onVisible = () => document.visibilityState === "visible" && sync();
    sync();
    window.addEventListener("cadence-focus-changed", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("cadence-focus-changed", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [logSession, offerCalendar]);

  // completion
  // Checked on its own clock, so the whole app doesn't re-render with the timer.
  const doneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || !focus.runStart) return;
    const check = () => {
      if (focusElapsed(focus) < focus.plannedSec || doneRef.current === focus.startedAt) return;
      doneRef.current = focus.startedAt;
      const f = focus;
      const saved = logSession(f, f.plannedSec, true);
      setFocus(null);
      if (settings.sound) chime("done");
      window.CadenceAndroid?.finishFocus("Focus session complete", `${f.title} · ${fmtDur(f.plannedSec / 60)}`);
      if (f.plannedSec > 300) offerCalendar(f, f.plannedSec, Date.now(), saved);
      else toast({ title: "Nice! Session complete!", description: `${f.title} · ${fmtDur(f.plannedSec / 60)} focused` });
    };
    check();
    const t = setInterval(check, 500);
    return () => clearInterval(t);
  }, [focus, logSession, offerCalendar, settings.sound, toast]);

  /* reminders */
  const { data: items } = useItems();
  const fired = useRef<Set<string>>(new Set());
  const startFocusRef = useRef(startFocus);
  startFocusRef.current = startFocus;
  useEffect(() => {
    if (!items) return;
    // Pop-ups off: the phone's notification makes the sound, so don't chime in the app too.
    const phoneOnly = settings.inAppPopups === false;
    const check = () => {
      const now = new Date();
      const nowM = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
      const day = ymd(now);
      const candidates = [
        ...blocksForDay(items, day).filter((b) => b.continues !== "before").map((b) => ({ b, offset: 0 })),
        ...blocksForDay(items, addDays(day, 1))
          .filter((b) => b.continues !== "before")
          .map((b) => ({ b, offset: 1440 })),
      ];
      for (const { b, offset } of candidates) {
        // auto-start timer at the start time
        if (b.item.autoTimer && offset === 0 && kindOf(b.item) !== "sleep") {
          const akey = `${b.key}:auto`;
          if (nowM >= b.start && nowM < b.start + 1.5 && !fired.current.has(akey)) {
            fired.current.add(akey);
            const mins = Math.max(1, Math.round(b.fullEnd - nowM));
            startFocusRef.current({ title: b.item.title, itemId: b.item.id, minutes: mins });
            window.CadenceAndroid?.notify(`Timer started: ${b.item.title}`, `${fmtDur(mins)} on the clock`);
            if (settings.sound && !phoneOnly) chime("soft");
            toast({ title: `Timer started · ${b.item.title}`, description: `${fmtDur(mins)} on the clock` });
          }
        }
        for (const r of remindersOf(b.item)) {
          if (r === 0 && b.item.autoTimer) continue;
          const startAbs = b.start + offset;
          const fireAt = startAbs - r;
          const key = `${b.key}:${r}`;
          if (nowM >= fireAt && nowM < fireAt + 2 && !fired.current.has(key)) {
            fired.current.add(key);
            const mins = Math.round(startAbs - nowM);
            const when = mins <= 0 ? "Starting now" : `Starts in ${fmtDur(mins)}`;
            const title = `${KIND_META[kindOf(b.item)].label}: ${b.item.title}`;
            const desc = `${when} · ${fmtTime(b.item.startTime)}${b.item.endTime ? "–" + fmtTime(b.item.endTime) : ""}`;
            if (settings.sound && !phoneOnly) chime("soft");
            const dur = Math.max(5, b.end - b.start);
            toast({
              title,
              description: desc,
              action:
                kindOf(b.item) !== "sleep" && !b.item.autoTimer ? (
                  <ToastAction
                    altText="Start focus timer"
                    data-testid="button-toast-start-focus"
                    onClick={() => startFocusRef.current({ title: b.item.title, itemId: b.item.id, minutes: dur })}
                  >
                    Start timer
                  </ToastAction>
                ) : undefined,
            });
          }
        }
      }
    };
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, [items, settings.sound, settings.inAppPopups, toast]);

  const value: Ctx = useMemo(() => ({
    theme,
    setDisplayMode,
    openEditor,
    openDetails,
    focus,
    startFocus,
    pauseFocus,
    resumeFocus,
    stopFocus,
    addFocusTime,
    askRepeatScope,
  }), [theme, openEditor, openDetails, focus, startFocus, pauseFocus, resumeFocus, stopFocus, addFocusTime, askRepeatScope]);

  return (
    <PlannerCtx.Provider value={value}>
      {children}
      <ItemDetails
        details={details}
        onClose={() => setDetails(null)}
        onEdit={() => {
          if (!details) return;
          const { target, occDate } = details;
          setDetails(null);
          openEditor(target, occDate);
        }}
      />
      <ItemEditor editing={editing} onClose={() => setEditing(null)} />
      <WhatsNew />
      <Dialog open={!!calendarOffer} onOpenChange={(o) => !o && setCalendarOffer(null)}>
        <DialogContent hideClose className="max-w-sm" data-testid="dialog-focus-calendar">
          <DialogTitle className="text-[15px] font-normal leading-relaxed tracking-normal">
            That was a great focus session! It's saved here, do you want it saved on your calendar too?
          </DialogTitle>
          <DialogDescription className="sr-only">Adds the session to your calendar at the times it took place</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setCalendarOffer(null)} data-testid="button-focus-calendar-no">No</Button>
            <Button size="sm" onClick={saveOfferToCalendar} data-testid="button-focus-calendar-yes">Yes</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!scopeAsk} onOpenChange={(o) => !o && answerScope(null)}>
        <DialogContent hideClose className="max-w-sm" data-testid="dialog-repeat-scope">
          <DialogHeader className="text-left">
            <DialogTitle className="text-[15px] font-normal leading-relaxed tracking-normal">This item repeats! What do you want to change?</DialogTitle>
            <DialogDescription className="sr-only">Change just this one, or every time it repeats</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => answerScope("one")} data-testid="button-scope-one">Just this one</Button>
            <Button size="sm" onClick={() => answerScope("all")} data-testid="button-scope-all">All of them</Button>
          </div>
        </DialogContent>
      </Dialog>
    </PlannerCtx.Provider>
  );
}

/** "Show notes in journal", for an item's details and for calendar imports. */
export function JournalNotesCheckbox({ id, checked, onChange, className }: { id: string; checked: boolean; onChange: (on: boolean) => void; className?: string }) {
  return (
    <label className={cn("flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground", className)}>
      <input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={id} />
      Show notes in journal
    </label>
  );
}

/** The details window's checkbox for a task, or check circle for a habit, for one day. */
function DetailCheck({ item: i, day }: { item: Item; day: string }) {
  const { toggle, cycle } = useItemMutations();
  const { settings } = useSettings();
  if (i.kind === "task") {
    const done = completionsOf(i).has(day);
    const c = taskColor(i, settings);
    return (
      <button type="button" onClick={() => toggle.mutate({ id: i.id, date: day })}
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 transition-colors"
        style={{ borderColor: c, background: done ? c : "transparent" }}
        aria-label={done ? `Mark ${i.title} not done` : `Mark ${i.title} done`} aria-pressed={done} data-testid="button-detail-check">
        {done && <Check className="h-4 w-4 text-background" strokeWidth={3} />}
      </button>
    );
  }
  const mk = markOf(i, day);
  const c = colorOf(i);
  return (
    <button type="button" onClick={() => cycle.mutate({ id: i.id, date: day })}
      className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition-colors"
      style={{ borderColor: c, background: fillOf(mk, c) }}
      aria-label={`${i.title}: ${["not done", "half done", "done"][mk]}`} data-testid="button-detail-check">
      {mk === 2 && <Check className="h-4 w-4 text-background" strokeWidth={3} />}
    </button>
  );
}

function ItemDetails({ details, onClose, onEdit }: {
  details: { target: Item; occDate?: string } | null; onClose: () => void; onEdit: () => void;
}) {
  const { data: items } = useItems();
  const { update } = useItemMutations();
  const { settings } = useSettings();
  // The live copy, so the journal checkbox and check marks reflect what was just saved.
  const i = details && (items?.find((x) => x.id === details.target.id) ?? details.target);
  // Tasks and habits can be checked off from here, for the day they were opened from.
  // A deadline task is checked off (and shown) for the due date it's open for.
  const deadline = !!i && isDeadlineTask(i);
  const dueDay = i && deadline ? dueDateFor(i, details?.occDate || todayStr()) ?? details?.occDate ?? i.date : null;
  const checkDay = i ? (dueDay ?? (details?.occDate || (i.kind === "habit" ? todayStr() : i.date))) : "";
  const checkable = !!i && i.id > 0 && (i.kind === "task" || i.kind === "habit") && occursOn(i, checkDay);
  const tags = i?.kind === "task" ? itemTags(i, settings).slice(0, 1) : [];
  // A deadline task shows its due date, whichever day it was opened from.
  const d = dueDay ?? (details?.occDate || i?.date || "");
  return (
    <Dialog open={!!details} onOpenChange={(open) => !open && onClose()}>
      {/* Long titles, links, and notes wrap anywhere, and the window scrolls rather than growing off screen. */}
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto scroll-thin [overflow-wrap:anywhere]" data-testid="dialog-item-details">
        {i && <>
          <div className="flex items-start gap-3 pr-8">
            {checkable && <DetailCheck item={i} day={checkDay} />}
            <DialogHeader className="min-w-0 flex-1 text-left">
              <DialogTitle className="min-w-0 text-lg leading-snug">{i.title}</DialogTitle>
              <DialogDescription>{KIND_META[kindOf(i)].label}</DialogDescription>
            </DialogHeader>
          </div>
          {tags.length > 0 && (
            <TwoRows className="-mt-1 gap-1.5">
              {tags.map((t) => <TagChip key={t.name} tag={t} />)}
            </TwoRows>
          )}
          <div className="h-1 rounded-full" style={{ background: colorOf(i) }} />
          <div className="grid grid-cols-1 gap-3 text-sm">
            {/* A habit has no start date to show, only the day it was opened from. */}
            {(i.kind !== "habit" || details?.occDate) && <div>
              <div className="text-xs text-muted-foreground">{deadline ? "Due" : recOf(i).freq !== "none" && !details?.occDate ? "Starts" : "Date"}</div>
              <div>{fmtDate(d)}{i.endDate && i.endDate > i.date ? ` – ${fmtDate(i.endDate)}` : ""}</div>
            </div>}
            {i.startTime && <div>
              <div className="text-xs text-muted-foreground">Time</div>
              <div>{fmtTime(i.startTime, true)} – {fmtTime(i.endTime, true)}{i.endDate && i.endDate > i.date ? " (ends later)" : ""}</div>
            </div>}
            {i.startTime && remindersOf(i).length > 0 && <div>
              <div className="text-xs text-muted-foreground">{remindersOf(i).length > 1 ? "Reminders" : "Reminder"}</div>
              <div className="first-letter:uppercase">{remindersOf(i).map((m) => (REMINDERS.find((r) => r.v === String(m))?.l ?? `${fmtDur(m)} before`).toLowerCase()).join(", ")}</div>
            </div>}
            {recOf(i).freq !== "none" && <div>
              <div className="text-xs text-muted-foreground">Repeats</div>
              <div>{recLabel(i)}</div>
            </div>}
            {/* A place opens the maps app, a link opens in the browser. */}
            {i.location && <div><LocationLink location={i.location} /></div>}
            {i.notes && <p className="whitespace-pre-wrap break-words text-muted-foreground"><Linked text={i.notes} /></p>}
            {i.notes?.trim() && i.kind !== "habit" && i.id > 0 && (
              <JournalNotesCheckbox id="checkbox-notes-journal" checked={!i.journalOff && i.journalId != null}
                onChange={(on) => update.mutate({ id: i.id, journalOff: !on })} />
            )}
          </div>
          <div className="flex justify-center">
            <Button variant="outline" size="sm" className="h-8 rounded-full px-5 text-xs" onClick={onEdit} data-testid="button-detail-edit">
              Edit
            </Button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}

/* ============ focus dock ============ */
/**
 * A habit's streak: a flame and the days in a row it's been done, or, greyed, a count below zero of
 * the days in a row it's been missed. Nothing at zero unless `zero`.
 */
export function StreakBadge({ streak, className, zero = false }: { streak: number; className?: string; zero?: boolean }) {
  if (!streak && !zero) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-medium tnum",
      streak > 0 ? "text-[hsl(var(--k-task))]" : "text-muted-foreground", className)}
      title={streak > 0 ? `${streak}-day streak` : streak < 0 ? `Missed ${-streak} ${streak === -1 ? "day" : "days"} in a row` : "No streak yet"}
      data-testid="text-streak">
      <Flame className="h-3.5 w-3.5" />
      {streak < 0 ? `−${-streak}` : streak}
    </span>
  );
}

export function Ring({ pct, size = 44, stroke = 4, color, track = "hsl(var(--border))" }: { pct: number; size?: number; stroke?: number; color?: string; track?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color || "hsl(var(--primary))"}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, pct)))}
        style={{ transition: "stroke-dashoffset .5s linear" }}
      />
    </svg>
  );
}

export const clock = (sec: number) => {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

/* ============ item editor ============ */
/** "Save for tomorrow" and the like: where a habit's repeating count starts instead of today. */
const NEXT_PERIOD: Partial<Record<Recurrence["freq"], { label: string; date: (today: string) => string }>> = {
  daily: { label: "tomorrow", date: (d) => addDays(d, 1) },
  weekly: { label: "next week", date: (d) => addDays(d, 7) },
  monthly: { label: "next month", date: (d) => shiftYmd(d, 0, 1) },
  yearly: { label: "next year", date: (d) => shiftYmd(d, 1, 0) },
};
/** A date moved by whole years and months, keeping the day of the month where it can. */
function shiftYmd(d: string, years: number, months: number) {
  const [y, m, day] = d.split("-").map(Number);
  const target = new Date(y + years, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return ymd(new Date(target.getFullYear(), target.getMonth(), Math.min(day, last)));
}

type FormVals = {
  title: string;
  tags: string[];
  kind: Kind;
  /** The day it's on (a task's due date; a habit keeps this out of sight as its pattern's anchor). */
  date: string;
  /** No time: all day (a task: any time that day). */
  allDay: boolean;
  /** When a task can be done: only on its due date, any day before it, or from a set date. */
  avail: "day" | "before" | "from";
  /** "From a date": the first day; a repeating task opens as many days before each due date. */
  availableFrom: string;
  endDate: string;
  startTime: string;
  endTime: string;
  freq: Recurrence["freq"];
  interval: number;
  days: number[];
  until: string;
  reminder: string;
  extraReminders: string[];
  priority: string;
  autoTimer: boolean;
  location: string;
  notes: string;
  /** The item's own color ("" for its kind's); a task takes its tag's instead. */
  color: string;
};

/** "Any day before" is stored as a year's window: a year before a one-off's due date, or 365 days' lead. */
const ANY_DAY_BEFORE = 365;

/** The reminder choices, for items and the default for new ones. */
export const REMINDERS = [
  { v: "none", l: "No reminder" },
  { v: "0", l: "At start time" },
  { v: "5", l: "5 min before" },
  { v: "10", l: "10 min before" },
  { v: "15", l: "15 min before" },
  { v: "30", l: "30 min before" },
  { v: "60", l: "1 hour before" },
  { v: "1440", l: "1 day before" },
];

type Editing = { target: Item | Partial<InsertItem>; occDate?: string; onCreated?: (item: Item) => void };
function ItemEditor({ editing, onClose }: { editing: Editing | null; onClose: () => void }) {
  const open = !!editing;
  const existing = editing && "id" in editing.target && typeof (editing.target as Item).id === "number" ? (editing.target as Item) : null;
  const { settings } = useSettings();
  const { create, update, remove, skip } = useItemMutations();
  const saveItem = useSaveItem();
  const { toast } = useToast();

  const form = useForm<FormVals>({ defaultValues: toForm(blankItem({}), settings.defaultReminder) });
  const { register, watch, setValue, handleSubmit, reset } = form;

  useEffect(() => {
    if (!editing) return;
    const t = editing.target as any;
    const base = existing ?? blankItem({ date: todayStr(), reminder: settings.defaultReminder, ...t });
    reset(toForm(base as any, settings.defaultReminder));
  }, [editing]); // eslint-disable-line

  const v = watch();
  const rec = recOf((existing as any) || { recurrence: '{"freq":"none"}' });
  const isRecurring = existing && rec.freq !== "none";
  const isFeed = existing?.source.startsWith("feed:");

  const onSubmit = handleSubmit(async (f) => {
    if (!f.title.trim()) return;
    const task = f.kind === "task", habit = f.kind === "habit";
    const timed = !f.allDay || f.kind === "sleep";
    // A habit has no dates and never stops repeating.
    if (habit) f = { ...f, endDate: f.date, until: "", freq: f.freq === "none" ? "daily" : f.freq };
    if (task) f = { ...f, endDate: f.date };
    if (!f.date || !task && !habit && (!f.endDate || f.endDate < f.date || dayDiff(f.date, f.endDate) > 366)) {
      toast({ title: "Check the end date", description: "Choose an end date on or after the start, within one year", variant: "destructive" });
      return;
    }
    // When a task can be done. A one-off one opens on a day; a repeating one the same number of days
    // before each due date.
    let avail = task ? f.avail : "day";
    if (avail === "from" && (!f.availableFrom || f.availableFrom > f.date)) {
      toast({ title: "Check the dates", description: "Available from must be on or before the due date", variant: "destructive" });
      return;
    }
    const before = avail === "from" ? Math.min(ANY_DAY_BEFORE, dayDiff(f.availableFrom, f.date)) : ANY_DAY_BEFORE;
    if (avail === "from" && before === 0) avail = "day";
    const oneOff = f.freq === "none";
    const r: Recurrence = { freq: f.freq };
    if (r.freq !== "none") {
      if (f.interval > 1) r.interval = Number(f.interval);
      if (f.freq === "weekly") r.days = f.days.length ? [...f.days].sort() : [dow(f.date)];
      if (f.until) r.until = f.until;
    }
    const start = f.startTime || "09:00";
    const payload: Partial<InsertItem> = {
      title: f.title.trim(),
      kind: f.kind,
      date: f.date,
      availableFrom: avail !== "day" && oneOff ? addDays(f.date, -before) : null,
      leadDays: avail !== "day" && !oneOff ? before : null,
      // A task's color comes from its tag; other items keep the color picked for them, if any.
      color: existing?.source.startsWith("feed:") && f.kind !== existing.kind ? null : task ? existing?.color ?? null : f.color || null,
      // A task is due at its time (no end); others end at their end time, the next day if that's earlier.
      endDate: task ? null : timed && f.endDate === f.date && toMin(f.endTime) <= toMin(start) ? addDays(f.date, 1) : f.endDate,
      allDay: !task && !timed,
      startTime: timed ? start : null,
      endTime: timed && !task ? f.endTime || fromMin(toMin(start) + 30) : null,
      recurrence: JSON.stringify(r),
      reminder: !timed || f.reminder === "none" ? null : Number(f.reminder),
      extraReminders: JSON.stringify(!timed || f.reminder === "none" ? []
        : [...new Set(f.extraReminders.map(Number))].filter((n) => n !== Number(f.reminder))),
      priority: f.priority,
      tags: JSON.stringify(task ? f.tags : []),
      autoTimer: timed && !task && f.kind !== "sleep" && f.autoTimer,
      location: f.location,
      notes: f.notes,
    };
    if (existing) {
      const scope = await saveItem(existing, payload, editing?.occDate);
      if (!scope) return;
    } else {
      const created = await create.mutateAsync(blankItem(payload));
      await editing?.onCreated?.(created);
    }
    onClose();
  });

  // Moving the start keeps the length.
  const setStart = (t: string) => {
    const length = (toMin(v.endTime) - toMin(v.startTime) + 1440) % 1440 || 30;
    setValue("startTime", t);
    setValue("endTime", fromMin(toMin(t) + length));
  };
  const timed = !v.allDay || v.kind === "sleep";
  const durMin = timed
    ? Math.max(1, dayDiff(v.date, v.endDate || v.date) * 1440 + toMin(v.endTime) - toMin(v.startTime) || 30)
    : settings.focusMinutes;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto scroll-thin" data-testid="dialog-item">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit" : "New"} {KIND_META[v.kind]?.label.toLowerCase() ?? "item"}</DialogTitle>
          <DialogDescription className="sr-only">Create or edit an item in your plan</DialogDescription>
        </DialogHeader>
        {isFeed && (
          <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Link2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Synced from a subscribed calendar. The name, times, location, and notes cannot be changed!
          </div>
        )}
        <form onSubmit={onSubmit} className="grid gap-4">
          <Input
            placeholder="What's the plan?"
            className={cn("text-base h-11", isFeed && "opacity-60")}
            readOnly={isFeed}
            {...register("title")}
            data-testid="input-title"
          />

          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type">
            {KINDS.filter((k) => k !== "sleep" || existing?.kind === "sleep").map((k) => {
              const M = KIND_META[k];
              const on = v.kind === k;
              return (
                <button
                  type="button"
                  key={k}
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setValue("kind", k);
                    // A new item takes the kind's usual timing: tasks and habits without a time, the rest timed.
                    if (!existing) setValue("allDay", k === "task" || k === "habit");
                    // ...and leaving Habit drops the daily repeat it came with.
                    if (!existing && v.kind === "habit" && k !== "habit") setValue("freq", "none");
                    if (k === "habit" && v.freq === "none") setValue("freq", "daily");
                    if (k === "sleep") {
                      setValue("allDay", false);
                      setValue("startTime", settings.bedTime);
                      setValue("endTime", settings.wakeTime);
                      setValue("endDate", addDays(v.date, 1));
                      if (v.freq === "none") setValue("freq", "daily");
                    }
                  }}
                  // Round pills like the rest of the window; the chosen kind is tinted and ringed in its color.
                  {...choicePill(on, M.cssVar, "inline-flex items-center gap-1.5 px-3")}
                  data-testid={`button-kind-${k}`}
                >
                  <M.icon className="h-4 w-4" style={{ color: `hsl(var(${M.cssVar}))` }} />
                  {M.label}
                </button>
              );
            })}
          </div>

          {/* Laid out like Google Calendar's: a row per part, its icon on the left, dates and times as pills. */}
          <div className="grid gap-3">
            {/* A synced item's name, times (with its repeat), location and notes come from its calendar (each
                sync would put them back), so they're locked. */}
            <EditorRow icon={Clock} locked={isFeed}>
              <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3">
                <span className="text-sm">{v.kind === "task" ? "Any time" : "All-day"}</span>
                <Switch checked={v.allDay && v.kind !== "sleep"} disabled={v.kind === "sleep"} onCheckedChange={(x) => setValue("allDay", x)} data-testid="switch-allday" />
              </label>
              {v.kind === "task" ? (
                // A task is due on a day, at a time unless it's any time that day.
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-10 text-sm text-muted-foreground">Due</span>
                  <DatePill value={v.date} onChange={(d) => setValue("date", d)} testId="input-date" label="Due date" />
                  {!v.allDay && <TimePill value={v.startTime} onChange={(t) => setValue("startTime", t)} testId="input-start" label="Due time" />}
                </div>
              ) : v.kind === "habit" ? (
                // Habits have no dates: just a time, if they have one.
                !v.allDay && (
                  <div className="flex flex-wrap items-center gap-2">
                    <TimePill value={v.startTime} onChange={(t) => setStart(t)} testId="input-start" label="Start time" />
                    <span className="text-muted-foreground">–</span>
                    <TimePill value={v.endTime} onChange={(t) => setValue("endTime", t)} testId="input-end" label="End time" />
                  </div>
                )
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <DatePill value={v.date} onChange={(d) => {
                      if (v.date && v.endDate) setValue("endDate", addDays(d, dayDiff(v.date, v.endDate)));
                      setValue("date", d);
                    }} testId="input-date" label={v.freq !== "none" ? "Starts" : "Start date"} />
                    {timed && <TimePill value={v.startTime} onChange={(t) => setStart(t)} testId="input-start" label="Start time" />}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <DatePill value={v.endDate} min={v.date} onChange={(d) => setValue("endDate", d)} testId="input-end-date" label="End date" />
                    {timed && (
                      <span className="flex items-center gap-2">
                        <TimePill value={v.endTime} onChange={(t) => {
                          setValue("endTime", t);
                          if (v.endDate === v.date && toMin(t) <= toMin(v.startTime)) setValue("endDate", addDays(v.date, 1));
                        }} testId="input-end" label="End time" />
                      </span>
                    )}
                  </div>
                </>
              )}
            </EditorRow>

            {v.kind === "task" && (
              <EditorRow icon={CalendarClock}>
                <Select value={v.avail} onValueChange={(x) => {
                  if (!x) return;
                  const mode = x as FormVals["avail"];
                  setValue("avail", mode);
                  if (mode === "from" && (!v.availableFrom || v.availableFrom > v.date)) setValue("availableFrom", addDays(v.date, -1));
                }}>
                  <SelectTrigger className="h-9 w-fit gap-2 rounded-full px-3.5" aria-label="Available" data-testid="select-available">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">On the day</SelectItem>
                    <SelectItem value="before">Any day before</SelectItem>
                    <SelectItem value="from">From a date</SelectItem>
                  </SelectContent>
                </Select>
                {v.avail === "from" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">Available to complete from</span>
                    <DatePill value={v.availableFrom} max={v.date} onChange={(d) => setValue("availableFrom", d)} testId="input-available-from" label="Available from" />
                    {v.freq !== "none" && v.availableFrom && v.availableFrom < v.date && (
                      <span className="text-xs text-muted-foreground">
                        {(() => { const n = dayDiff(v.availableFrom, v.date); return `${n} ${n === 1 ? "day" : "days"} before each one`; })()}
                      </span>
                    )}
                  </div>
                )}
              </EditorRow>
            )}

            <EditorRow icon={Repeat} locked={isFeed}>
              <Select value={v.freq} onValueChange={(x) => setValue("freq", x as Recurrence["freq"])}>
                <SelectTrigger className="h-9 w-fit gap-2 rounded-full px-3.5" data-testid="select-repeat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {v.kind !== "habit" && <SelectItem value="none">Does not repeat</SelectItem>}
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekdays">Weekdays (Mon–Fri)</SelectItem>
                  <SelectItem value="weekly">Weekly on…</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
              {v.freq === "weekly" && (
                <WeekdayPills value={v.days} onChange={(days) => setValue("days", days)} weekStartsOn={settings.weekStartsOn}
                  label="Days of week" testId="button-day-" />
              )}
              {v.freq !== "none" && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Every</span>
                  <Input id="f-interval" type="number" min={1} max={30} className="h-9 w-16 rounded-full text-center" {...register("interval", { valueAsNumber: true })} data-testid="input-interval" />
                  <span className="text-muted-foreground">
                    {{ daily: "day(s)", weekdays: "week", weekly: "week(s)", monthly: "month(s)", yearly: "year(s)", none: "" }[v.freq]}
                  </span>
                  {v.kind !== "habit" && (
                    <>
                      <span className="ml-1 text-muted-foreground">until</span>
                      <DatePill value={v.until} min={v.date} onChange={(d) => setValue("until", d)} testId="input-until" label="Repeat until" empty="Forever" clearable />
                    </>
                  )}
                </div>
              )}
              {/* A saved habit that isn't on today can have its schedule moved so its next day is today. */}
              {existing && v.kind === "habit" && (() => {
                const shift = shiftedToToday({
                  kind: "habit", uid: existing.uid, exceptions: existing.exceptions, date: v.date,
                  recurrence: JSON.stringify({ freq: v.freq, interval: v.interval > 1 ? Number(v.interval) : undefined, days: v.days.length ? v.days : undefined }),
                }, todayStr());
                if (!shift) return null;
                return (
                  <Button type="button" variant="outline" size="sm" className="w-fit rounded-full" data-testid="button-shift-today" onClick={() => {
                    setValue("date", shift.date);
                    setValue("freq", shift.recurrence.freq);
                    setValue("days", shift.recurrence.days ?? []);
                  }}>
                    Shift to today
                  </Button>
                );
              })()}
            </EditorRow>

            {timed && v.kind !== "sleep" && (
              <EditorRow icon={Bell}>
                {[v.reminder, ...(v.reminder === "none" ? [] : v.extraReminders)].map((value, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Select value={value} onValueChange={(x) => {
                      if (index === 0) {
                        setValue("reminder", x);
                        if (x === "none") setValue("extraReminders", []);
                      } else setValue("extraReminders", v.extraReminders.map((e, k) => (k === index - 1 ? x : e)));
                    }}>
                      <SelectTrigger className="h-9 w-fit gap-2 rounded-full px-3.5" aria-label={index ? `Reminder ${index + 1}` : "Reminder"}
                        data-testid={index ? `select-extra-reminder-${index - 1}` : "select-reminder"}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REMINDERS.filter((r) => index === 0 || r.v !== "none").map((r) => (
                          <SelectItem key={r.v} value={r.v}>{v.kind === "task" && r.v === "0" ? "At due time" : r.l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {index > 0 && (
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                        onClick={() => setValue("extraReminders", v.extraReminders.filter((_, k) => k !== index - 1))}
                        aria-label={`Remove reminder ${index + 1}`} data-testid={`button-remove-reminder-${index - 1}`}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {v.reminder !== "none" && (
                  <button type="button" className="inline-flex h-7 w-fit items-center gap-1 rounded-full border border-dashed px-2.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary"
                    onClick={() => {
                      const used = new Set([v.reminder, ...v.extraReminders]);
                      const next = REMINDERS.find((r) => r.v !== "none" && !used.has(r.v))?.v ?? "0";
                      setValue("extraReminders", [...v.extraReminders, next]);
                    }}
                    data-testid="button-add-reminder">
                    <Plus className="h-3.5 w-3.5" /> add reminder
                  </button>
                )}
              </EditorRow>
            )}

            {timed && v.kind !== "sleep" && v.kind !== "task" && (
              <EditorRow icon={Timer}>
                <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3" data-testid="row-autotimer">
                  <span className="min-w-0">
                    <span className="block text-sm">Start a timer when it begins</span>
                    <span className="block text-xs text-muted-foreground">Counts down {fmtDur(durMin)} at {fmtTime(v.startTime, true)}</span>
                  </span>
                  <Switch checked={v.autoTimer} onCheckedChange={(x) => setValue("autoTimer", x)} data-testid="switch-autotimer" />
                </label>
              </EditorRow>
            )}

            {v.kind === "task" && (
              <EditorRow icon={Hash}>
                <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm">Task Tags</span>
                  <TaskTagField value={v.tags} onChange={(t) => setValue("tags", t)} />
                </div>
              </EditorRow>
            )}

            {v.kind === "task" && (
              <EditorRow icon={Flag}>
                <div className="flex gap-1.5" role="radiogroup" aria-label="Priority">
                  {["low", "normal", "high"].map((p) => (
                    <button type="button" key={p} role="radio" aria-checked={v.priority === p} onClick={() => setValue("priority", p)}
                      className={cn("h-9 flex-1 rounded-full border text-sm capitalize",
                        v.priority === p ? "bg-secondary text-foreground font-medium border-foreground/20" : "text-muted-foreground hover-elevate")}
                      data-testid={`button-priority-${p}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </EditorRow>
            )}

            {v.kind !== "task" && v.kind !== "sleep" && (
              <EditorRow icon={Palette}>
                <ItemColorPicker kind={v.kind} value={v.color} onChange={(c) => setValue("color", c)} />
              </EditorRow>
            )}

            <EditorRow icon={MapPin} locked={isFeed}>
              <Input placeholder="Location or link" className="h-9" readOnly={isFeed} {...register("location")} data-testid="input-location" />
            </EditorRow>
            <EditorRow icon={AlignLeft}>
              <Textarea placeholder="Notes" rows={3} readOnly={isFeed} className={cn(isFeed && "opacity-60")} {...register("notes")} data-testid="input-notes" />
            </EditorRow>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {existing && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  onClick={async () => {
                    await remove.mutateAsync(existing.id);
                    onClose();
                  }}
                  data-testid="button-delete"
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  {isRecurring ? "Delete series" : "Delete"}
                </Button>
                {isRecurring && editing?.occDate && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={async () => {
                      await skip.mutateAsync({ id: existing.id, date: editing.occDate! });
                      onClose();
                    }}
                    data-testid="button-skip"
                  >
                    <X className="h-4 w-4 mr-1.5" />
                    Skip this day
                  </Button>
                )}
              </>
            )}
            <div className="flex-1" />
            {/* A habit repeating every few days, weeks, months or years can start its count from the next one instead of now. */}
            {v.kind === "habit" && v.interval > 1 && NEXT_PERIOD[v.freq] && (
              <Button type="button" variant="outline" disabled={create.isPending || update.isPending} data-testid="button-save-next"
                onClick={() => {
                  // Monthly and yearly habits keep their chosen day, a period later; the others start from today.
                  setValue("date", NEXT_PERIOD[v.freq]!.date(v.freq === "monthly" || v.freq === "yearly" ? v.date : todayStr()));
                  void onSubmit();
                }}>
                Save for {NEXT_PERIOD[v.freq]!.label}
              </Button>
            )}
            <Button type="submit" disabled={create.isPending || update.isPending} data-testid="button-save">
              {existing ? "Save" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function toForm(i: InsertItem | Item, defReminder: number | null): FormVals {
  const r = recOf(i as Item);
  const isNew = !("id" in i && typeof (i as Item).id === "number");
  const task = i.kind === "task";
  const lead = task ? i.leadDays ?? 0 : 0;
  const fromDays = task && i.availableFrom ? dayDiff(i.availableFrom, i.date) : 0;
  // A new task is doable any day before it's due, as they were before tasks had these choices.
  const avail: FormVals["avail"] = lead >= ANY_DAY_BEFORE || fromDays >= ANY_DAY_BEFORE ? "before"
    : lead > 0 || fromDays > 0 ? "from" : task && !isNew ? "day" : "before";
  const date = i.date || todayStr();
  return {
    title: i.title || "",
    kind: ((KINDS as readonly string[]).includes(i.kind as string) ? i.kind : "event") as Kind,
    date,
    allDay: !i.startTime,
    avail,
    availableFrom: lead > 0 ? addDays(date, -Math.min(lead, ANY_DAY_BEFORE)) : i.availableFrom || addDays(date, -1),
    endDate: i.endDate || (i.startTime && i.endTime && toMin(i.endTime) <= toMin(i.startTime) ? addDays(date, 1) : date),
    startTime: i.startTime || "09:00",
    endTime: i.endTime || fromMin(toMin(i.startTime || "09:00") + 60),
    freq: r.freq,
    interval: r.interval || 1,
    days: r.days || [],
    until: r.until || "",
    reminder: i.reminder == null ? (i.title ? "none" : defReminder == null ? "none" : String(defReminder)) : String(i.reminder),
    extraReminders: i.reminder == null ? [] : remindersOf(i as Item).filter((n) => n !== i.reminder).map(String),
    priority: i.priority || "normal",
    tags: taskTagsOf(i).slice(0, 1), // a task has one tag
    autoTimer: !!(i as any).autoTimer,
    location: i.location || "",
    notes: i.notes || "",
    color: i.color || "",
  };
}

/** A part of the item window: its icon in the left column, its controls beside it. */
function EditorRow({ icon: Icon, children, locked = false }: { icon: typeof Clock; children: ReactNode; locked?: boolean }) {
  return (
    // Locked: shown but not changeable (inert takes it out of taps and the keyboard).
    <div className={cn("flex gap-3", locked && "opacity-60")} {...(locked ? { inert: "" } : {})}>
      <Icon className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-2">{children}</div>
    </div>
  );
}

const PILL = "relative inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm tnum hover-elevate focus-within:ring-2 focus-within:ring-ring";

/**
 * A date as a pill ("Tue, Sep 29"; the year when it isn't this one). The phone's date picker opens from
 * an invisible date input laid over it. `clearable` adds an x (an empty value shows `empty`).
 */
function DatePill({ value, onChange, min, max, testId, label, empty = "Pick a date", clearable = false }: {
  value: string; onChange: (d: string) => void; min?: string; max?: string; testId: string; label: string; empty?: string; clearable?: boolean;
}) {
  const shown = value ? fmtDate(value, { weekday: "short", month: "short", day: "numeric", ...(value.slice(0, 4) !== todayStr().slice(0, 4) ? { year: "numeric" } : {}) }) : empty;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn(PILL, !value && "text-muted-foreground")}>
        {shown}
        <input type="date" value={value} min={min} max={max} aria-label={label} data-testid={testId}
          onChange={(e) => (e.target.value || clearable) && onChange(e.target.value)}
          onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* opens on its own */ } }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </span>
      {clearable && value && (
        <button type="button" onClick={() => onChange("")} className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-label={`Clear ${label.toLowerCase()}`}>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

/** A time as a pill ("7:30 PM"), opening the phone's time picker the same way. */
function TimePill({ value, onChange, testId, label }: { value: string; onChange: (t: string) => void; testId: string; label: string }) {
  return (
    <span className={PILL}>
      {fmtTime(value, true)}
      <input type="time" step={60} value={value} aria-label={label} data-testid={testId}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* opens on its own */ } }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
    </span>
  );
}

export function useNow(intervalMs = 30000) {
  const [n, setN] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setN(new Date()), intervalMs);
    // Timers pause while the app is in the background, so catch up when it comes back.
    const back = () => { if (!document.hidden) setN(new Date()); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, [intervalMs]);
  return n;
}

/**
 * Asks the journal for a new entry. The journal may still be opening, so the ask waits until it
 * takes it (on opening, or right away if it's already open).
 */
let journalComposeWanted = false;
export function requestJournalCompose() {
  journalComposeWanted = true;
  window.dispatchEvent(new Event("cadence:journal-compose"));
}
export function takeJournalCompose() {
  const wanted = journalComposeWanted;
  journalComposeWanted = false;
  return wanted;
}

/** Today's date, kept current past midnight and when the app comes back from the background. */
export function useToday() {
  const [today, setToday] = useState(todayStr);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      setToday(todayStr());
      clearTimeout(timer);
      const now = new Date();
      timer = setTimeout(update, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 1000);
    };
    update();
    const back = () => { if (!document.hidden) update(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", back); };
  }, []);
  return today;
}

/**
 * An item's color: its kind's (the first choice) or one of the tag colors. The item is drawn in it,
 * with its kind's color kept as the bar down its left edge.
 */
function ItemColorPicker({ kind, value, onChange }: { kind: Kind; value: string; onChange: (color: string) => void }) {
  const kindColor = `hsl(var(${KIND_META[kind].cssVar}))`;
  const choices = ["", ...TAG_COLORS];
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Color">
      {choices.map((c) => {
        const on = value === c;
        return (
          <button key={c || "kind"} type="button" role="radio" aria-checked={on} aria-label={c ? `Color ${c}` : `${KIND_META[kind].label} color`}
            onClick={() => onChange(c)}
            className={cn("grid h-7 w-7 place-items-center rounded-full", on && "ring-2 ring-offset-2 ring-offset-background ring-foreground/60")}
            style={{ background: c || kindColor }} data-testid={`swatch-item-${c ? c.slice(1) : "kind"}`}>
            {on && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}
