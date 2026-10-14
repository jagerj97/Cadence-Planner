import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Home,
  CalendarRange,
  NotebookPen,
  Repeat,
  Timer,
  CheckSquare,
  Settings as SettingsIcon,
  Plus,
  X,
} from "lucide-react";
import { usePlanner, FocusClock, requestJournalCompose } from "./planner";
import { KIND_META, fromMin, todayStr } from "@/lib/cal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Kind } from "@shared/schema";
import { useSettings } from "@/lib/data";
import { QuickAdd } from "@/pages/today";
import { cn } from "@/lib/utils";
import { endTurn, frame, setTurnOrder, startTurn, turning, type TurnMode, type TurnState } from "./pageTurn";
import { reducedMotion } from "./motion";


export const NAV = [
  { href: "/", label: "Today", icon: Home, match: (l: string) => l === "/" || l.startsWith("/day") },
  { href: "/calendar", label: "Calendar", icon: CalendarRange, match: (l: string) => /^\/(calendar|week|month|agenda|timeline|schedule)/.test(l) },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, match: (l: string) => l.startsWith("/tasks") },
  { href: "/habits", label: "Habits", icon: Repeat, match: (l: string) => l.startsWith("/habits") },
  { href: "/journal", label: "Journal", icon: NotebookPen, match: (l: string) => l.startsWith("/journal") },
  { href: "/focus", label: "Focus", icon: Timer, match: (l: string) => l.startsWith("/focus") },
];
/** The pages in the user's order (Settings, Customize); ones not placed yet keep their usual spot at the end. */
export function orderNav(saved: string[] | undefined) {
  const placed = (saved ?? []).map((href) => NAV.find((n) => n.href === href)).filter((n): n is (typeof NAV)[number] => !!n);
  return [...new Set([...placed, ...NAV])];
}
function useNav() {
  const { settings } = useSettings();
  return useMemo(() => orderNav(settings.navOrder), [settings.navOrder]);
}

const SETTINGS_NAV = { href: "/settings", label: "Settings", icon: SettingsIcon, match: (l: string) => l.startsWith("/settings") || l.startsWith("/sync") };

function DrawerLinks({ onNavigate }: { onNavigate?: () => void }) {
  const [loc] = useLocation();
  const nav = useNav();
  const { focus } = usePlanner();
  const row = (n: (typeof NAV)[number]) => {
    const on = n.match(loc);
    return (
      <Link
        key={n.href}
        href={n.href}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-6 h-12 pl-6 pr-4 text-sm font-medium transition-colors",
          on ? "text-primary bg-sidebar-accent rounded-full mx-3 pl-3" : "text-foreground/80 hover:bg-sidebar-accent/70 hover:rounded-full mx-3 pl-3",
        )}
        aria-current={on ? "page" : undefined}
        data-testid={`link-nav-${n.label.toLowerCase()}`}
      >
        <n.icon className={cn("h-5 w-5", on ? "text-primary" : "text-muted-foreground")} />
        {n.label}
        {n.href === "/focus" && focus && <span className="ml-auto font-mono text-xs tnum text-primary"><FocusClock /></span>}
      </Link>
    );
  };
  return (
    <>
      <nav className="py-2" aria-label="Main">
        {nav.map(row)}
      </nav>
    </>
  );
}

/** The kinds the + menu adds, with their names, icons and colors from KIND_META. */
const ADD_KINDS = (["task", "event", "meeting", "habit", "focus"] as const).map((kind) => ({
  kind, label: KIND_META[kind].label, icon: KIND_META[kind].icon, color: `hsl(var(${KIND_META[kind].cssVar}))`,
}));

/** The app bar's round icon buttons (settings and +). */
const APPBAR_BUTTON = "grid h-11 w-11 place-items-center rounded-full text-[hsl(var(--appbar-fg))] hover:bg-black/5 dark:hover:bg-white/10";

/** Away from Today, the + opens the new item window set to the kind that fits the page. */
function kindForPage(loc: string): Kind | "journal" {
  if (loc.startsWith("/tasks")) return "task";
  if (loc.startsWith("/habits")) return "habit";
  if (loc.startsWith("/focus")) return "focus";
  if (loc.startsWith("/journal")) return "journal";
  return "event";
}

function AddMenu() {
  const [open, setOpen] = useState(false);
  const [loc, nav] = useLocation();
  const { openEditor } = usePlanner();
  const day = loc.startsWith("/day/") ? loc.slice(5) : todayStr();
  useEffect(() => setOpen(false), [loc]);

  const pick = (kind: Kind | "journal") => {
    setOpen(false);
    if (kind === "journal") {
      if (!loc.startsWith("/journal")) nav("/journal");
      requestJournalCompose();
      return;
    }
    const d = new Date();
    const m = Math.min(1410, Math.ceil((d.getHours() * 60 + d.getMinutes() + 1) / 30) * 30);
    if (kind === "task") return openEditor({ date: day, kind });
    openEditor({
      date: day,
      kind,
      startTime: fromMin(m),
      endTime: fromMin(Math.min(1439, m + 60)),
      ...(kind === "habit" ? { recurrence: '{"freq":"daily"}' } : {}),
    });
  };

  // Today keeps the full menu with quick add; other pages go straight to the matching item.
  const onToday = loc === "/" || loc.startsWith("/day/");
  if (!onToday) {
    return (
      <button
        onClick={() => pick(kindForPage(loc))}
        className={cn(APPBAR_BUTTON, "transition-colors")}
        aria-label="Add something"
        data-testid="button-add"
      >
        <AddIcon />
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(APPBAR_BUTTON, "transition-colors", open && "bg-black/10 dark:bg-white/15")}
          aria-label="Add something"
          aria-expanded={open}
          data-testid="button-add"
        >
          {/* The + turns into an x while the menu is open, like the settings gear. */}
          <AddIcon open={open} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,440px)] overflow-hidden p-0 shadow-lg">
        <div className="p-2.5 border-b">
          <QuickAdd appbar day={day} onDone={() => setOpen(false)} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-2">
          {ADD_KINDS.map((k) => (
            <button
              key={k.kind}
              onClick={() => pick(k.kind)}
              className="flex items-center gap-3 rounded-full py-1.5 pl-1.5 pr-3 text-sm font-medium hover:bg-muted text-left"
              data-testid={`button-add-${k.kind}`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white" style={{ background: k.color }}>
                <k.icon className="h-4 w-4" />
              </span>
              {k.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The app bar's +, drawn as big as the gear beside it (lucide's + fills 14 of its 24 units, the gear
 * about 20) with the same 2px lines. Open, it turns into an x the size of the settings x (12px across).
 */
const ADD_PX = 34;
const X_SCALE = (12 * Math.SQRT2) / (14 * ADD_PX / 24); // the +'s arms, turned 45°, span 12px
function AddIcon({ open = false }: { open?: boolean }) {
  return (
    <Plus size={ADD_PX} className="transition-[transform,stroke-width] duration-300"
      style={{ transform: open ? `rotate(135deg) scale(${X_SCALE})` : undefined, strokeWidth: (2 * 24) / ADD_PX / (open ? X_SCALE : 1) }} />
  );
}

let lastPage = "/"; // where the gear returns to when leaving Settings

/** Whether a touch began on something that scrolls sideways itself (a row of filters, the habit tracker). */
function sidewaysOwner(target: EventTarget | null, root: HTMLElement) {
  for (let el = target as HTMLElement | null; el && el !== root; el = el.parentElement) {
    const x = getComputedStyle(el).overflowX;
    if ((x === "auto" || x === "scroll") && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

/**
 * Whether everything that scrolls up and down under a touch (up to `root`) is already as far as it
 * goes toward `dir` (1: the bottom, -1: the top), so pulling on past it moves to the next or last date.
 */
function atScrollEnd(target: EventTarget | null, root: HTMLElement, dir: 1 | -1) {
  for (let el = target as HTMLElement | null; el && el !== root.parentElement; el = el.parentElement) {
    const y = getComputedStyle(el).overflowY;
    if ((y !== "auto" && y !== "scroll") || el.scrollHeight <= el.clientHeight + 1) continue;
    if (dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return false;
  }
  return true;
}

/** What a drag toward `dir` does: the change, how to take it back if it's let go of early, and whether it's a date. */
type Turn = { change: () => void; undo: () => void; mode: TurnMode };
type Axis = "x" | "y";

/**
 * Dragging across `ref` turns the page with the finger (see pageTurn): sideways, to the next or last
 * page; up and down (with `vertical`, where `plan` allows it), to the next or last date. It finishes
 * when let go past a third of the way (or flicked), or settles back (and is undone) if not. The change
 * is made, under the copy of the old page, as soon as the drag's direction is clear.
 * Holds (which pick items up to drag them), pinches, typing fields, diagonal moves and things that
 * scroll sideways themselves are left alone. The pages scroll only up and down (touch-action: pan-y),
 * so these listeners can be passive and never hold up scrolling.
 */
function usePageDrag(ref: React.RefObject<HTMLElement>, main: React.RefObject<HTMLElement>, page: React.RefObject<HTMLElement>,
  plan: (axis: Axis, dir: 1 | -1, target: EventTarget | null) => Turn | null, vertical: boolean) {
  const planRef = useRef(plan);
  planRef.current = plan;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    type Drag = {
      x: number; y: number; t0: number; target: EventTarget | null; sideways: boolean;
      axis?: Axis; dir?: 1 | -1; turn?: Turn; s?: TurnState;
      /** Where the drag took hold along its axis, how far it's gone, and how fast. */
      o: number; off: number; v: number; at: number; last: number;
    };
    let g: Drag | null = null;
    const along = (d: Drag, t: Touch) => (d.axis === "y" ? t.clientY : t.clientX);
    // Moves come faster than frames: only the latest is drawn, once a frame.
    let pending = 0;
    const drawSoon = (d: Drag) => {
      if (pending) return;
      pending = requestAnimationFrame(() => { pending = 0; if (g === d) frame(d.s!, Math.min(1, Math.abs(d.off) / d.s!.size)); });
    };
    // The rest of a touch goes to the element it began on, even once the change takes that element
    // away with the old page (when it no longer reaches `el`), so it's listened to there.
    let target: EventTarget | null = null;
    const listen = (on: EventTarget | null) => {
      target?.removeEventListener("touchmove", move as EventListener);
      target?.removeEventListener("touchend", end);
      target?.removeEventListener("touchcancel", end);
      target = on;
      on?.addEventListener("touchmove", move as EventListener, { passive: true });
      on?.addEventListener("touchend", end, { passive: true });
      on?.addEventListener("touchcancel", end, { passive: true });
    };
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      if (g?.turn) return; // a second finger mid-drag
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable=true]");
      g = !turning() && e.touches.length === 1 && !typing
        ? { x: t.clientX, y: t.clientY, t0: e.timeStamp, target: e.target, sideways: sidewaysOwner(e.target, el), o: 0, off: 0, v: 0, at: e.timeStamp, last: 0 }
        : null;
      listen(g ? e.target : null);
    };
    function move(e: TouchEvent) {
      const d = g;
      if (!d) return;
      if (e.touches.length > 1) return end();
      const t = e.touches[0];
      if (!d.turn) {
        const dx = t.clientX - d.x, dy = t.clientY - d.y;
        // A finger resting first is a hold (which picks an item up to drag it), not a swipe.
        if (e.defaultPrevented || e.timeStamp - d.t0 > 450) { g = null; return; }
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        const axis: Axis | null = Math.abs(dx) >= Math.abs(dy) * 1.5 ? "x" : Math.abs(dy) >= Math.abs(dx) * 1.5 ? "y" : null;
        if (!axis || (axis === "x" && d.sideways) || (axis === "y" && !vertical)) { g = null; return; }
        const dir = (axis === "x" ? dx : dy) < 0 ? 1 : -1;
        const turn = planRef.current(axis, dir, d.target), m = main.current, p = page.current;
        if (!turn || !m || !p || turning() || reducedMotion()) {
          g = null;
          // Without motion, a swipe still makes its change, all at once.
          if (turn && !turning()) turn.change();
          return;
        }
        // Measured from here on, so the page doesn't jump the few pixels it took to tell it's a swipe.
        Object.assign(d, { axis, dir, turn, s: startTurn(m, p, dir, turn.mode) });
        d.o = d.last = along(d, t);
        // The copy shows first; the next page is drawn under it a frame later, so the drag starts at once.
        requestAnimationFrame(() => turn.change());
      }
      // Only toward the side it started; back past the start it just rests there.
      const pos = along(d, t), gone = pos - d.o;
      d.off = d.dir! > 0 ? Math.min(0, gone) : Math.max(0, gone);
      if (e.timeStamp > d.at) d.v = 0.6 * d.v + 0.4 * ((pos - d.last) / (e.timeStamp - d.at));
      d.at = e.timeStamp;
      d.last = pos;
      drawSoon(d);
    }
    function end() {
      const d = g;
      g = null;
      listen(null);
      if (!d?.turn) return;
      cancelAnimationFrame(pending);
      pending = 0;
      const size = d.s!.size, side = -d.dir!; // the way the old page (or date) leaves
      const done = Math.abs(d.off) > size / 3 ? d.v * side > -0.3 : d.v * side > 0.4;
      const left = done ? size - Math.abs(d.off) : Math.abs(d.off);
      endTurn(d.s!, done, Math.round(Math.max(140, Math.min(280, left * 0.85))), d.turn.undo);
    }
    el.addEventListener("touchstart", down, { passive: true });
    return () => {
      el.removeEventListener("touchstart", down);
      listen(null);
    };
  }, [ref, main, page, vertical]);
}

export function Shell({ children }: { children: ReactNode }) {
  const [loc, nav] = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const pages = useNav();
  const page = pages.findIndex((n) => n.match(loc));
  const pageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  // Dragging sideways (on a page or the bottom bar) goes to the next or previous page in the bar (in
  // the user's order; the end pages go no further). On a page whose dates go up and down (Today, the
  // calendar's weeks and months: data-turn-body="y"), dragging up past the end of what scrolls goes to
  // the next date, and down past the top to the last, pressing the page's own next or previous button
  // (marked data-swipe).
  const plan = (axis: Axis, dir: 1 | -1, target: EventTarget | null): Turn | null => {
    const main = mainRef.current;
    if (!main) return null;
    const stepSel = `[data-swipe="${dir > 0 ? "next" : "prev"}"]:not(:disabled)`;
    const before = window.location.hash;
    // Back the way it came: through history if the change moved there, else (a date the page keeps
    // itself, like the calendar's) its other step button.
    const undo = () => (window.location.hash !== before ? window.history.back()
      : main.querySelector<HTMLButtonElement>(`[data-swipe="${dir > 0 ? "prev" : "next"}"]`)?.click());
    if (axis === "y") {
      if (!main.querySelector('[data-turn-body="y"]') || !main.querySelector(stepSel) || !atScrollEnd(target, main, dir)) return null;
      return { change: () => main.querySelector<HTMLButtonElement>(stepSel)?.click(), undo, mode: "date" };
    }
    const next = page < 0 ? undefined : pages[page + dir];
    return next ? { change: () => nav(next.href), undo, mode: "page" } : null;
  };
  // Taps and links turn the page too (pageTurn), in the bar's order.
  setTurnOrder(pages);
  usePageDrag(mainRef, mainRef, pageRef, plan, true);
  usePageDrag(barRef, mainRef, pageRef, plan, false);
  const { settings } = useSettings();
  const { focus } = usePlanner();
  const inSettings = SETTINGS_NAV.match(loc);
  if (!inSettings) lastPage = loc;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      {/* app bar: settings + add, nothing else */}
      {/* Runs up behind the phone's status bar (--safe-top), carrying its color and wash with it. */}
      <header className="appbar relative z-30 box-content flex h-14 md:h-16 shrink-0 items-center justify-between px-3 md:px-5 pt-[var(--safe-top,env(safe-area-inset-top,0px))]">
        <button
          onClick={() => nav(inSettings ? lastPage : "/settings")}
          className={cn(APPBAR_BUTTON, "transition-transform duration-300", inSettings && "bg-black/10 dark:bg-white/15 rotate-90")}
          aria-label={inSettings ? "Close settings" : "Settings"}
          aria-pressed={inSettings}
          data-testid="button-settings"
        >
          {inSettings ? <X className="h-6 w-6 -rotate-90" /> : <SettingsIcon className="h-6 w-6" />}
        </button>
        {/* Cadence, sitting on the bar's bottom edge (unless she's been let outside) */}
        {!settings.plain && <img
          src="./cadence-sitting.svg"
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute bottom-0 left-1/2 h-10 md:h-12 w-auto -translate-x-1/2 select-none"
          data-testid="img-cadence-appbar"
        />}
        <AddMenu />
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="wellness-rail hidden md:flex w-56 shrink-0 flex-col overflow-y-auto bg-sidebar border-r z-20">
          <DrawerLinks />
        </aside>
        <main ref={mainRef} data-pages className="relative flex-1 min-w-0 flex flex-col overflow-hidden pb-[calc(3.5rem+var(--safe-bottom,env(safe-area-inset-bottom,0px)))] md:pb-0">
          {/* Keyed by the page (not its place in the bar, which reordering the bar changes). */}
          <div key={pages[page]?.href ?? (inSettings ? "/settings" : "other")} ref={pageRef} data-page
            className="flex flex-1 min-h-0 flex-col">
            {children}
          </div>
        </main>
      </div>

      {/* bottom bar (phones) */}
      {/* Runs down behind the phone's navigation bar (--safe-bottom), its color filling that strip. */}
      <nav ref={barRef} className="wellness-bottom md:hidden fixed bottom-0 inset-x-0 z-40 flex px-1 pb-[var(--safe-bottom,env(safe-area-inset-bottom,0px))]" aria-label="Main">
        {pages.map((n) => {
          const on = n.match(loc);
          const timer = n.href === "/focus" && focus;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn("flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2 text-[12px]", on || timer ? "text-primary font-semibold" : "text-muted-foreground")}
              aria-current={on ? "page" : undefined}
              data-testid={`link-mnav-${n.label.toLowerCase()}`}
            >
              <span className={cn("grid h-7 w-11 place-items-center rounded-full transition-colors duration-300", on && "bg-primary/10")}>
                {/* The page you're on: its icon grows a little, with a quick spring. */}
                <n.icon className={cn("h-5 w-5 transition-transform duration-300 ease-[cubic-bezier(.3,1.6,.5,1)] motion-reduce:transition-none", on && "scale-[1.18]")} />
              </span>
              <span className="truncate max-w-full tnum">{timer ? <FocusClock /> : n.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    // data-turn-head: held as it is while a date slides (see pageTurn).
    <header data-turn-head className="grid gap-3 px-4 md:px-6 pt-5 md:pt-7 pb-1">
      <div className="min-w-0">
        <h1 className="text-[26px] md:text-[31px] font-semibold tracking-tight leading-tight truncate" data-testid="text-page-title">
          {title}
        </h1>
        {sub && <div className="text-sm text-muted-foreground">{sub}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
