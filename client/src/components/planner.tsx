import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Item, InsertItem, Kind, Recurrence } from "@shared/schema";
import { KINDS } from "@shared/schema";
import { useForm } from "react-hook-form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { blankItem, useItemMutations, useItems, useSettings } from "@/lib/data";
import {
  KIND_META,
  DAY_SHORT,
  addDays,
  blocksForDay,
  dayDiff,
  dow,
  fmtDur,
  fmtDate,
  fmtTime,
  fromMin,
  kindOf,
  colorOf,
  recOf,
  toMin,
  todayStr,
  ymd,
} from "@/lib/cal";
import { cn } from "@/lib/utils";
import { Pause, Play, Square, Plus, Trash2, Timer, X, Coffee, Link2 } from "lucide-react";

/* ============ sound ============ */
let audioCtx: AudioContext | null = null;
export function chime(kind: "soft" | "done" = "soft") {
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

export function systemNotify(title: string, body: string) {
  if (window.CadenceAndroid) {
    window.CadenceAndroid.notify(title, body);
    return true;
  }
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, icon: "./favicon.svg", tag: title + body });
      return true;
    }
  } catch {
    /* blocked in sandbox */
  }
  return false;
}

/* ============ theme ============ */
type Theme = "light" | "dark";

/* ============ focus timer ============ */
export type FocusState = {
  itemId: number | null;
  title: string;
  mode: "focus" | "break";
  plannedSec: number;
  accSec: number; // accumulated before current run
  runStart: number | null; // ms timestamp when running
  startedAt: string;
};

type Ctx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  openEditor: (target: Item | Partial<InsertItem>, occDate?: string) => void;
  openDetails: (target: Item, occDate?: string) => void;
  focus: FocusState | null;
  elapsed: number;
  startFocus: (opts: { title: string; itemId?: number | null; minutes: number; mode?: "focus" | "break" }) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  stopFocus: (completed?: boolean) => void;
  addFocusTime: (min: number) => void;
};
const PlannerCtx = createContext<Ctx | null>(null);
export const usePlanner = () => {
  const c = useContext(PlannerCtx);
  if (!c) throw new Error("PlannerProvider missing");
  return c;
};

export function PlannerProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const [themeLoaded, setThemeLoaded] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    if (themeLoaded) window.CadenceAndroid?.setAppearance?.(theme);
  }, [theme, themeLoaded]);

  const { toast } = useToast();
  const { settings, data: savedSettings } = useSettings();
  useEffect(() => {
    if (savedSettings) {
      setTheme(savedSettings.appearanceTheme);
      setThemeLoaded(true);
    }
  }, [savedSettings?.appearanceTheme]);
  useEffect(() => {
    document.documentElement.dataset.colorTheme = settings.colorTheme || "orange";
  }, [settings.colorTheme]);

  /* editor */
  const [editing, setEditing] = useState<{ target: Item | Partial<InsertItem>; occDate?: string } | null>(null);
  const [details, setDetails] = useState<{ target: Item; occDate?: string } | null>(null);
  const openEditor = useCallback((target: Item | Partial<InsertItem>, occDate?: string) => setEditing({ target, occDate }), []);
  const openDetails = useCallback((target: Item, occDate?: string) => setDetails({ target, occDate }), []);

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
      window.CadenceAndroid.scheduleFocus(focus.runStart + remaining,
        focus.mode === "focus" ? "Focus session complete" : "Break's over",
        focus.mode === "focus" ? focus.title : "Ready for the next block?");
    } else window.CadenceAndroid.cancelFocus();
  }, [focus]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!focus?.runStart) return;
    const t = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [focus?.runStart]);
  const elapsed = focus ? focus.accSec + (focus.runStart ? (Date.now() - focus.runStart) / 1000 : 0) : 0;
  void tick;

  const logSession = useCallback(async (f: FocusState, sec: number, completed: boolean) => {
    if (f.mode !== "focus" || sec < 30) return;
    try {
      await apiRequest("POST", "/api/sessions", {
        itemId: f.itemId,
        title: f.title,
        date: todayStr(),
        startedAt: f.startedAt,
        plannedMin: Math.round(f.plannedSec / 60),
        actualSec: Math.round(sec),
        completed,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
    } catch {
      /* ignore */
    }
  }, []);

  const startFocus: Ctx["startFocus"] = useCallback(
    ({ title, itemId = null, minutes, mode = "focus" }) => {
      setFocus((prev) => {
        if (prev) {
          const sec = prev.accSec + (prev.runStart ? (Date.now() - prev.runStart) / 1000 : 0);
          logSession(prev, sec, false);
        }
        return {
          itemId,
          title,
          mode,
          plannedSec: Math.max(1, minutes) * 60,
          accSec: 0,
          runStart: Date.now(),
          startedAt: new Date().toISOString(),
        };
      });
    },
    [logSession],
  );
  const pauseFocus = () =>
    setFocus((f) => (f && f.runStart ? { ...f, accSec: f.accSec + (Date.now() - f.runStart) / 1000, runStart: null } : f));
  const resumeFocus = () => setFocus((f) => (f && !f.runStart ? { ...f, runStart: Date.now() } : f));
  const stopFocus = (completed = false) => {
    if (focus) logSession(focus, elapsed, completed);
    setFocus(null);
  };
  const addFocusTime = (min: number) => setFocus((f) => (f ? { ...f, plannedSec: f.plannedSec + min * 60 } : f));

  // completion
  const doneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || !focus.runStart) return;
    if (elapsed >= focus.plannedSec && doneRef.current !== focus.startedAt) {
      doneRef.current = focus.startedAt;
      const f = focus;
      logSession(f, f.plannedSec, true);
      setFocus(null);
      if (settings.sound) chime("done");
      if (f.mode === "focus") {
        if (window.CadenceAndroid) window.CadenceAndroid.finishFocus("Focus session complete", `${f.title} · ${fmtDur(f.plannedSec / 60)}`);
        else systemNotify("Focus session complete", `${f.title} · ${fmtDur(f.plannedSec / 60)}`);
        toast({
          title: "Nice work — session complete",
          description: `${f.title} · ${fmtDur(f.plannedSec / 60)} focused`,
          action: (
            <ToastAction
              altText="Take a break"
              onClick={() => startFocus({ title: "Break", minutes: settings.breakMinutes, mode: "break" })}
            >
              {settings.breakMinutes}m break
            </ToastAction>
          ),
        });
      } else {
        if (window.CadenceAndroid) window.CadenceAndroid.finishFocus("Break's over", "Ready for the next block?");
        else systemNotify("Break's over", "Ready for the next block?");
        toast({ title: "Break's over", description: "Ready for the next block?" });
      }
    }
  }, [elapsed, focus, logSession, settings, startFocus, toast]);

  /* reminders */
  const { data: items } = useItems();
  const fired = useRef<Set<string>>(new Set());
  const startFocusRef = useRef(startFocus);
  startFocusRef.current = startFocus;
  useEffect(() => {
    if (!items) return;
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
            systemNotify(`Timer started: ${b.item.title}`, `${fmtDur(mins)} on the clock`);
            if (settings.sound) chime("soft");
            toast({ title: `Timer started · ${b.item.title}`, description: `${fmtDur(mins)} on the clock. Open Focus to pause or stop it.` });
          }
        }
        const r = b.item.reminder;
        if (r == null || (r === 0 && b.item.autoTimer)) continue;
        const startAbs = b.start + offset;
        const fireAt = startAbs - r;
        const key = `${b.key}:${r}`;
        if (nowM >= fireAt && nowM < fireAt + 2 && !fired.current.has(key)) {
          fired.current.add(key);
          const mins = Math.round(startAbs - nowM);
          const when = mins <= 0 ? "Starting now" : `Starts in ${fmtDur(mins)}`;
          const title = `${KIND_META[kindOf(b.item)].label}: ${b.item.title}`;
          const desc = `${when} · ${fmtTime(b.item.startTime)}${b.item.endTime ? "–" + fmtTime(b.item.endTime) : ""}`;
          if (!window.CadenceAndroid) systemNotify(title, desc);
          if (settings.sound) chime("soft");
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
    };
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, [items, settings.sound, toast]);

  const value: Ctx = {
    theme,
    setTheme,
    openEditor,
    openDetails,
    focus,
    elapsed,
    startFocus,
    pauseFocus,
    resumeFocus,
    stopFocus,
    addFocusTime,
  };

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
          if (target.source === "routine") window.location.hash = "#/settings";
          else openEditor(target, occDate);
        }}
      />
      <ItemEditor editing={editing} onClose={() => setEditing(null)} />
    </PlannerCtx.Provider>
  );
}

function ItemDetails({ details, onClose, onEdit }: {
  details: { target: Item; occDate?: string } | null; onClose: () => void; onEdit: () => void;
}) {
  const i = details?.target;
  const routine = i?.source === "routine";
  const d = details?.occDate || i?.date || "";
  return (
    <Dialog open={!!details} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-item-details">
        {i && <>
          <DialogHeader className="pr-20 text-left">
            <DialogTitle className="text-lg leading-snug">{i.title}</DialogTitle>
            <DialogDescription>{routine ? "Background routine · every day" : KIND_META[kindOf(i)].label}</DialogDescription>
          </DialogHeader>
          <Button variant="outline" size="sm" className="absolute right-12 top-4" onClick={onEdit} data-testid="button-detail-edit">
            {routine ? "Edit routine" : "Edit"}
          </Button>
          <div className="h-1 rounded-full" style={{ background: colorOf(i) }} />
          <div className="grid gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">{routine ? "Every day" : "Date"}</div>
              <div>{routine ? "Repeats daily, including past days" : `${fmtDate(d)}${i.endDate && i.endDate > i.date ? ` – ${fmtDate(i.endDate)}` : ""}`}</div>
            </div>
            {i.startTime && <div>
              <div className="text-xs text-muted-foreground">Time</div>
              <div>{fmtTime(i.startTime, true)} – {fmtTime(i.endTime, true)}{i.endDate && i.endDate > i.date && !routine ? " (ends later)" : ""}</div>
            </div>}
            {i.kind === "task" && i.availableFrom && <div className="text-muted-foreground">Available from {fmtDate(i.availableFrom)} · due {fmtDate(i.date)}</div>}
            {i.location && <div className="break-words">{i.location}</div>}
            {i.notes && <p className="whitespace-pre-wrap break-words text-muted-foreground">{i.notes}</p>}
            {routine && <p className="text-xs text-muted-foreground">A routine is a background guide, not a calendar event.</p>}
          </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}

/* ============ focus dock ============ */
export function Ring({ pct, size = 44, stroke = 4, color }: { pct: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={stroke} />
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

function FocusDock() {
  const { focus, elapsed, pauseFocus, resumeFocus, stopFocus, addFocusTime } = usePlanner();
  if (!focus) return null;
  const remaining = focus.plannedSec - elapsed;
  const pct = Math.min(1, elapsed / focus.plannedSec);
  const brk = focus.mode === "break";
  const art = brk ? "hsl(var(--k-habit))" : "hsl(var(--k-focus))";
  return (
    <div
      className="fixed inset-x-0 bottom-14 md:bottom-0 z-50 h-[72px] bg-card shadow-[0_-2px_6px_rgba(0,0,0,0.14)]"
      data-testid="focus-dock"
      role="timer"
      aria-live="off"
    >
      {/* progress line, Play Music style */}
      <div className="absolute inset-x-0 top-0 h-1 bg-muted" aria-hidden>
        <div className="h-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${pct * 100}%` }} />
        <div className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-primary shadow" style={{ left: `${pct * 100}%` }} />
      </div>
      <div className="flex h-full items-center gap-3 pl-0 pr-3 md:pr-6">
        <div className="grid h-[72px] w-[72px] shrink-0 place-items-center text-white" style={{ background: `linear-gradient(135deg, ${art}, color-mix(in srgb, ${art} 60%, #000))` }}>
          {brk ? <Coffee className="h-7 w-7" /> : <Timer className="h-7 w-7" />}
        </div>
        <div className="min-w-0 flex-1 md:flex-none md:w-64">
          <div className="text-sm font-medium truncate">{brk ? "Break" : focus.title}</div>
          <div className="text-xs text-muted-foreground truncate">{brk ? "Stretch, breathe, get water" : focus.runStart ? "Focusing" : "Paused"}</div>
        </div>
        <div className="flex items-center gap-1 md:mx-auto">
          <button onClick={() => addFocusTime(5)} className="hidden sm:grid h-10 px-2 place-items-center rounded-full text-xs font-medium text-muted-foreground hover:bg-muted" aria-label="Add 5 minutes" data-testid="button-focus-add5">
            +5 MIN
          </button>
          {focus.runStart ? (
            <button onClick={pauseFocus} className="grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-md" aria-label="Pause" data-testid="button-focus-pause">
              <Pause className="h-5 w-5" fill="currentColor" />
            </button>
          ) : (
            <button onClick={resumeFocus} className="grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-md" aria-label="Resume" data-testid="button-focus-resume">
              <Play className="h-5 w-5 ml-0.5" fill="currentColor" />
            </button>
          )}
          <button onClick={() => stopFocus(false)} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Stop" data-testid="button-focus-stop">
            <Square className="h-4 w-4" fill="currentColor" />
          </button>
        </div>
        <div className="font-mono text-lg md:text-xl tnum md:w-64 md:text-right" data-testid="text-focus-remaining">
          {clock(remaining)}
        </div>
      </div>
    </div>
  );
}

/* ============ item editor ============ */
type TimeMode = "timed" | "anytime" | "allday" | "deadline";
type FormVals = {
  title: string;
  kind: Kind;
  date: string;
  availableFrom: string;
  endDate: string;
  timeMode: TimeMode;
  startTime: string;
  endTime: string;
  freq: Recurrence["freq"];
  interval: number;
  days: number[];
  until: string;
  reminder: string;
  priority: string;
  autoTimer: boolean;
  location: string;
  notes: string;
};

const REMINDERS = [
  { v: "none", l: "No reminder" },
  { v: "0", l: "At start time" },
  { v: "5", l: "5 min before" },
  { v: "10", l: "10 min before" },
  { v: "15", l: "15 min before" },
  { v: "30", l: "30 min before" },
  { v: "60", l: "1 hour before" },
  { v: "1440", l: "1 day before" },
];

function ItemEditor({ editing, onClose }: { editing: { target: Item | Partial<InsertItem>; occDate?: string } | null; onClose: () => void }) {
  const open = !!editing;
  const existing = editing && "id" in editing.target && typeof (editing.target as Item).id === "number" ? (editing.target as Item) : null;
  const { settings } = useSettings();
  const { create, update, remove, skip } = useItemMutations();
  const { startFocus } = usePlanner();
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
    if (!f.date || (f.timeMode !== "deadline" && (!f.endDate || f.endDate < f.date || dayDiff(f.date, f.endDate) > 366))) {
      toast({ title: "Check the end date", description: "Choose an end date on or after the start, within one year.", variant: "destructive" });
      return;
    }
    if (f.timeMode === "deadline" && (!f.availableFrom || f.availableFrom > f.date)) {
      toast({ title: "Check the dates", description: "Available from must be on or before the due date.", variant: "destructive" });
      return;
    }
    const r: Recurrence = { freq: f.timeMode === "deadline" ? "none" : f.freq };
    if (r.freq !== "none") {
      if (f.interval > 1) r.interval = Number(f.interval);
      if (f.freq === "weekly") r.days = f.days.length ? [...f.days].sort() : [dow(f.date)];
      if (f.until) r.until = f.until;
    }
    const payload: Partial<InsertItem> = {
      title: f.title.trim(),
      kind: f.kind,
      date: f.date,
      availableFrom: f.kind === "task" && f.timeMode === "deadline" ? f.availableFrom : null,
      color: existing?.source.startsWith("feed:") && f.kind !== existing.kind ? null : existing?.color ?? null,
      endDate: f.timeMode === "deadline" ? null : f.timeMode === "timed" && f.endDate === f.date && toMin(f.endTime) <= toMin(f.startTime)
        ? addDays(f.date, 1)
        : f.endDate,
      allDay: f.timeMode === "allday",
      startTime: f.timeMode === "timed" ? f.startTime || "09:00" : null,
      endTime: f.timeMode === "timed" ? f.endTime || fromMin(toMin(f.startTime) + 30) : null,
      recurrence: JSON.stringify(r),
      reminder: f.timeMode === "deadline" || f.reminder === "none" ? null : Number(f.reminder),
      priority: f.priority,
      autoTimer: f.timeMode === "timed" && f.kind !== "sleep" && f.autoTimer,
      location: f.location,
      notes: f.notes,
    };
    if (existing) await update.mutateAsync({ id: existing.id, ...payload });
    else await create.mutateAsync(blankItem(payload));
    toast({ title: existing ? "Saved" : "Added to your plan", description: payload.title });
    onClose();
  });

  const durMin = v.timeMode === "timed"
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
            Synced from a subscribed calendar. Your type, color, reminders, and completion choices stay in Cadence when it syncs.
          </div>
        )}
        <form onSubmit={onSubmit} className="grid gap-4">
          <Input
            placeholder="What's the plan?"
            className="text-base h-11"
            {...register("title")}
            data-testid="input-title"
          />

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5" role="radiogroup" aria-label="Type">
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
                    if (k !== "task" && v.timeMode === "deadline") setValue("timeMode", "anytime");
                    if (k === "habit" && v.freq === "none") setValue("freq", "daily");
                    if (k === "sleep") {
                      setValue("timeMode", "timed");
                      setValue("startTime", settings.bedTime);
                      setValue("endTime", settings.wakeTime);
                      setValue("endDate", addDays(v.date, 1));
                      if (v.freq === "none") setValue("freq", "daily");
                    }
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-xs font-medium transition-colors",
                    on ? "border-transparent text-foreground" : "text-muted-foreground hover-elevate",
                  )}
                  style={on ? { background: `hsl(var(${M.cssVar}) / .16)`, boxShadow: `inset 0 0 0 1.5px hsl(var(${M.cssVar}))` } : undefined}
                  data-testid={`button-kind-${k}`}
                >
                  <M.icon className="h-4 w-4" style={{ color: `hsl(var(${M.cssVar}))` }} />
                  {M.label}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="f-date">{v.timeMode === "deadline" ? "Due date" : v.freq !== "none" ? "Starts" : "Date"}</Label>
              <Input id="f-date" type="date" {...register("date", {
                onChange: (e) => {
                  if (v.timeMode !== "deadline" && e.target.value && v.date && v.endDate) setValue("endDate", addDays(e.target.value, dayDiff(v.date, v.endDate)));
                },
              })} data-testid="input-date" />
            </div>
            <div className="grid gap-1.5">
              <Label>When</Label>
              <Select value={v.timeMode} onValueChange={(x) => {
                setValue("timeMode", x as TimeMode);
                if (x === "deadline") {
                  setValue("freq", "none");
                  setValue("availableFrom", v.availableFrom && v.availableFrom <= v.date ? v.availableFrom : (todayStr() <= v.date ? todayStr() : v.date));
                }
              }}>
                <SelectTrigger data-testid="select-timemode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="timed">At a set time</SelectItem>
                  <SelectItem value="anytime">Anytime that day</SelectItem>
                  <SelectItem value="allday">All day</SelectItem>
                  {v.kind === "task" && <SelectItem value="deadline">Anytime before due date</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>

          {v.timeMode === "deadline" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="f-available-from">Available from</Label>
              <Input id="f-available-from" type="date" max={v.date} {...register("availableFrom")} data-testid="input-available-from" />
              <span className="text-xs text-muted-foreground">You can check this task off from this day until its due date. It appears on the calendar on its due date.</span>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="f-end-date">End date</Label>
              <Input id="f-end-date" type="date" min={v.date} {...register("endDate")} data-testid="input-end-date" />
              <span className="text-xs text-muted-foreground">
                {v.timeMode === "allday" ? "Includes this entire day." : "Choose a later day for an item that lasts across days."}
              </span>
            </div>
          )}

          {v.timeMode === "timed" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="f-start">Start</Label>
                <Input
                  id="f-start"
                  type="time"
                  step={60}
                  {...register("startTime", {
                    onChange: (e) => {
                      // keep duration when moving the start
                      const oldDur = (toMin(v.endTime) - toMin(v.startTime) + 1440) % 1440 || 30;
                      setValue("endTime", fromMin(toMin(e.target.value) + oldDur));
                    },
                  })}
                  data-testid="input-start"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="f-end">
                  End <span className="text-muted-foreground font-normal">· {fmtDur(durMin)}</span>
                </Label>
                <Input id="f-end" type="time" step={60} {...register("endTime", {
                  onChange: (e) => {
                    if (v.endDate === v.date && toMin(e.target.value) <= toMin(v.startTime)) {
                      setValue("endDate", addDays(v.date, 1));
                    }
                  },
                })} data-testid="input-end" />
              </div>
            </div>
          )}

          {v.timeMode !== "deadline" && <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Repeat</Label>
              <Select value={v.freq} onValueChange={(x) => setValue("freq", x as Recurrence["freq"])}>
                <SelectTrigger data-testid="select-repeat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Doesn't repeat</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekdays">Weekdays (Mon–Fri)</SelectItem>
                  <SelectItem value="weekly">Weekly on…</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Reminder</Label>
              <Select value={v.reminder} onValueChange={(x) => setValue("reminder", x)}>
                <SelectTrigger data-testid="select-reminder">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMINDERS.map((r) => (
                    <SelectItem key={r.v} value={r.v}>
                      {r.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>}

          {v.timeMode !== "deadline" && v.freq === "weekly" && (
            <div className="flex gap-1.5" aria-label="Days of week">
              {DAY_SHORT.map((d, i) => {
                const on = v.days.includes(i);
                return (
                  <button
                    type="button"
                    key={d}
                    aria-pressed={on}
                    onClick={() => setValue("days", on ? v.days.filter((x) => x !== i) : [...v.days, i])}
                    className={cn(
                      "h-9 flex-1 rounded-md border text-xs font-medium",
                      on ? "bg-primary text-primary-foreground border-transparent" : "text-muted-foreground hover-elevate",
                    )}
                    data-testid={`button-day-${i}`}
                  >
                    {d.slice(0, 2)}
                  </button>
                );
              })}
            </div>
          )}

          {v.timeMode !== "deadline" && v.freq !== "none" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="f-interval">Every</Label>
                <div className="flex items-center gap-2">
                  <Input id="f-interval" type="number" min={1} max={30} className="w-20" {...register("interval", { valueAsNumber: true })} data-testid="input-interval" />
                  <span className="text-sm text-muted-foreground">
                    {{ daily: "day(s)", weekdays: "week", weekly: "week(s)", monthly: "month(s)", yearly: "year(s)", none: "" }[v.freq]}
                  </span>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="f-until">Repeat until (optional)</Label>
                <Input id="f-until" type="date" {...register("until")} data-testid="input-until" />
              </div>
            </div>
          )}

          {v.timeMode === "timed" && v.kind !== "sleep" && (
            <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 cursor-pointer" data-testid="row-autotimer">
              <span className="flex items-center gap-2.5">
                <Timer className="h-4 w-4 text-primary" />
                <span>
                  <span className="block text-sm font-medium">Start a timer when it begins</span>
                  <span className="block text-xs text-muted-foreground">Counts down {fmtDur(durMin)} automatically at {fmtTime(v.startTime, true)}</span>
                </span>
              </span>
              <Switch checked={v.autoTimer} onCheckedChange={(x) => setValue("autoTimer", x)} data-testid="switch-autotimer" />
            </label>
          )}

          {v.kind === "task" && (
            <div className="grid gap-1.5">
              <Label>Priority</Label>
              <div className="flex gap-1.5">
                {["low", "normal", "high"].map((p) => (
                  <button
                    type="button"
                    key={p}
                    aria-pressed={v.priority === p}
                    onClick={() => setValue("priority", p)}
                    className={cn(
                      "h-9 flex-1 rounded-md border text-sm capitalize",
                      v.priority === p ? "bg-secondary text-foreground font-medium border-foreground/20" : "text-muted-foreground hover-elevate",
                    )}
                    data-testid={`button-priority-${p}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Input placeholder="Location or link" {...register("location")} data-testid="input-location" />
          <Textarea placeholder="Notes" rows={3} {...register("notes")} data-testid="input-notes" />

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {existing && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  onClick={async () => {
                    await remove.mutateAsync(existing.id);
                    toast({ title: "Deleted", description: existing.title });
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
                      toast({ title: "Skipped this one", description: `${existing.title} · ${editing.occDate}` });
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
            {v.kind !== "sleep" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  startFocus({ title: v.title || "Focus", itemId: existing?.id ?? null, minutes: durMin });
                  onClose();
                }}
                data-testid="button-editor-focus"
              >
                <Timer className="h-4 w-4 mr-1.5" />
                Start timer
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
  const timeMode: TimeMode = i.kind === "task" && i.availableFrom ? "deadline" : i.allDay ? "allday" : i.startTime ? "timed" : "anytime";
  return {
    title: i.title || "",
    kind: ((KINDS as readonly string[]).includes(i.kind as string) ? i.kind : "event") as Kind,
    date: i.date || todayStr(),
    availableFrom: i.availableFrom || (todayStr() <= i.date ? todayStr() : i.date),
    endDate: i.endDate || (i.startTime && i.endTime && toMin(i.endTime) <= toMin(i.startTime) ? addDays(i.date, 1) : i.date),
    timeMode,
    startTime: i.startTime || "09:00",
    endTime: i.endTime || (i.startTime ? fromMin(toMin(i.startTime) + 60) : "10:00"),
    freq: r.freq,
    interval: r.interval || 1,
    days: r.days || [],
    until: r.until || "",
    reminder: i.reminder == null ? (i.title ? "none" : defReminder == null ? "none" : String(defReminder)) : String(i.reminder),
    priority: i.priority || "normal",
    autoTimer: !!(i as any).autoTimer,
    location: i.location || "",
    notes: i.notes || "",
  };
}

export function useNow(intervalMs = 30000) {
  const [n, setN] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setN(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return n;
}

export function useMemoItems() {
  const q = useItems();
  return useMemo(() => q.data ?? [], [q.data]);
}
