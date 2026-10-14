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
import { usePlanner, useFocusElapsed, clock, requestJournalCompose } from "./planner";
import { KIND_META, fromMin, todayStr } from "@/lib/cal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Kind } from "@shared/schema";
import { useSettings } from "@/lib/data";
import { QuickAdd } from "@/pages/today";
import { cn } from "@/lib/utils";


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
  const elapsed = useFocusElapsed();
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
        {n.href === "/focus" && focus && <span className="ml-auto font-mono text-xs tnum text-primary">{clock(focus.plannedSec - elapsed)}</span>}
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

/** Whether a touch began on something that scrolls sideways itself, or takes sideways drags. */
function sidewaysOwner(target: EventTarget | null, root: HTMLElement) {
  for (let el = target as HTMLElement | null; el && el !== root; el = el.parentElement) {
    if (el.matches("input, textarea, [contenteditable=true], [data-no-swipe]")) return true;
    const x = getComputedStyle(el).overflowX;
    if ((x === "auto" || x === "scroll") && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

/** Gives a copied page the scroll positions of the original (copies start scrolled to the top). */
function copyScroll(from: Element, to: Element) {
  // Only what can scroll (the copy has the same elements in the same order), not every element.
  const sel = '[class*="overflow-"]';
  const a = from.querySelectorAll(sel), b = to.querySelectorAll(sel);
  a.forEach((x, n) => {
    const y = b[n];
    if (y && (x.scrollTop || x.scrollLeft)) { y.scrollTop = x.scrollTop; y.scrollLeft = x.scrollLeft; }
  });
}

/** A copy of the page as it is, laid over it (it can't be tapped), to be dragged away. */
function coverOf(main: HTMLElement, page: HTMLElement) {
  const cover = page.cloneNode(true) as HTMLElement;
  cover.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  cover.querySelectorAll("[data-testid]").forEach((el) => el.removeAttribute("data-testid"));
  cover.removeAttribute("data-page");
  cover.setAttribute("aria-hidden", "true");
  cover.inert = true;
  Object.assign(cover.style, {
    position: "absolute", left: `${page.offsetLeft}px`, top: `${page.offsetTop}px`, width: `${page.offsetWidth}px`,
    height: `${page.offsetHeight}px`, zIndex: "10", pointerEvents: "none", background: "hsl(var(--background))",
    boxShadow: "0 0 12px rgb(0 0 0 / .22)", willChange: "transform, opacity", contain: "layout paint",
  });
  main.appendChild(cover);
  copyScroll(page, cover);
  return cover;
}

/** How far above the bottom bar a drag still counts as on the bar (changing the page, not the date). */
const BAR_REACH = 40;

/** The same page turn as a drag, played through on its own: for tapping a page in the bottom bar. */
function turnPage(main: HTMLElement, page: HTMLElement, dir: 1 | -1, change: () => void) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
  const cover = coverOf(main, page), w = page.offsetWidth, ms = 300;
  change();
  requestAnimationFrame(() => {
    const next = main.querySelector<HTMLElement>("[data-page]");
    next?.animate([{ transform: `translateX(${dir * 0.3 * w}px)` }, { transform: "none" }], { duration: ms, easing: EASE });
    cover.animate([{ transform: "none" }, { transform: `translateX(${-dir * w}px)` }], { duration: ms, easing: EASE })
      .finished.finally(() => cover.remove());
  });
}

/** What a drag toward `dir` does: the change, how to take it back if it's let go of early, and whether it's a date (`slide`). */
type Turn = { change: () => void; undo: () => void; slide?: boolean };

const EASE = "cubic-bezier(.2,.7,.3,1)";

/**
 * Dragging sideways across `ref` follows the finger, then finishes when let go past a third of the
 * way (or flicked), or settles back (and is undone) if not. Either way, once the drag is clearly
 * sideways a copy of the page is laid over it and the change is made underneath:
 * - A page turn: the copy is dragged away (a small shadow under it), uncovering the next page, which
 *   drifts over from that side.
 * - A date slide: the copy slides and fades as the new date fades in under it.
 * Holds (which pick items up to drag them), pinches, mostly-vertical moves and things that scroll or
 * drag sideways themselves are left alone.
 */
function usePageDrag(ref: React.RefObject<HTMLElement>, main: React.RefObject<HTMLElement>, page: React.RefObject<HTMLElement>,
  plan: (dir: 1 | -1, startY: number) => Turn | null) {
  const planRef = useRef(plan);
  planRef.current = plan;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    type Drag = { x: number; y: number; t0: number; dir?: 1 | -1; turn?: Turn; cover?: HTMLElement; w: number; off: number; v: number; at: number; lastX: number };
    let g: Drag | null = null;
    let settling = false;
    const current = () => main.current?.querySelector<HTMLElement>("[data-page]") ?? null;
    const style = (node: HTMLElement | null, transform: string, opacity: string, ms: number) => {
      if (!node) return;
      node.style.transition = ms ? `transform ${ms}ms ${EASE}, opacity ${ms}ms ${EASE}` : "none";
      node.style.transform = transform;
      node.style.opacity = opacity;
    };
    // Where the copy and the page under it are, `off` along the way.
    const place = (d: Drag, off: number, ms = 0) => {
      const p = Math.min(1, Math.abs(off) / d.w), under = current();
      if (d.turn!.slide) {
        style(d.cover!, `translateX(${off}px)`, String(1 - p), ms);
        style(under, `translateX(${d.dir! * 0.15 * d.w * (1 - p)}px)`, String(Math.min(1, p * 1.4)), ms);
      } else {
        style(d.cover!, `translateX(${off}px)`, "", ms);
        style(under, p >= 1 ? "" : `translateX(${d.dir! * 0.3 * d.w * (1 - p)}px)`, "", ms);
      }
    };
    // Moves come faster than frames: only the latest is drawn, once a frame.
    let frame = 0;
    const placeSoon = (d: Drag) => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (g === d) place(d, d.off); });
    };
    // The rest of a touch goes to the element it began on, even once the change takes that element
    // away with the old page (when it no longer reaches `el`), so it's listened to there.
    let target: EventTarget | null = null;
    const listen = (on: EventTarget | null) => {
      target?.removeEventListener("touchmove", move as EventListener);
      target?.removeEventListener("touchend", end);
      target?.removeEventListener("touchcancel", end);
      target = on;
      on?.addEventListener("touchmove", move as EventListener, { passive: false });
      on?.addEventListener("touchend", end, { passive: true });
      on?.addEventListener("touchcancel", end, { passive: true });
    };
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      if (g?.turn) return; // a second finger mid-drag
      g = !settling && e.touches.length === 1 && !sidewaysOwner(e.target, el)
        ? { x: t.clientX, y: t.clientY, t0: e.timeStamp, w: 1, off: 0, v: 0, at: e.timeStamp, lastX: t.clientX } : null;
      listen(g ? e.target : null);
    };
    function move(e: TouchEvent) {
      const d = g;
      if (!d) return;
      if (e.touches.length > 1) return end();
      const t = e.touches[0], dx = t.clientX - d.x, dy = t.clientY - d.y;
      if (!d.turn) {
        // A finger resting first is a hold (which picks an item up to drag it), not a swipe.
        if (e.defaultPrevented || e.timeStamp - d.t0 > 450) { g = null; return; }
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.5) { g = null; return; }
        const dir = dx < 0 ? 1 : -1, turn = planRef.current(dir, d.y), m = main.current, p = page.current;
        if (!turn || !m || !p) { g = null; return; }
        Object.assign(d, { dir, turn, w: p.offsetWidth, cover: coverOf(m, p) });
        // A date's copy is see-through, with no edge: the two dates simply crossfade.
        if (turn.slide) {
          Object.assign(d.cover!.style, { background: "transparent", boxShadow: "none" });
          style(p, "", "0", 0);
        }
        // The copy shows first; the next page is drawn under it a frame later, so the drag starts at once.
        requestAnimationFrame(() => turn.change());
      }
      if (e.cancelable) e.preventDefault();
      // Only toward the side it started; back past the start it just rests there.
      d.off = d.dir! > 0 ? Math.min(0, dx) : Math.max(0, dx);
      if (e.timeStamp > d.at) d.v = 0.6 * d.v + 0.4 * ((t.clientX - d.lastX) / (e.timeStamp - d.at));
      d.at = e.timeStamp;
      d.lastX = t.clientX;
      placeSoon(d);
    }
    function end() {
      const d = g;
      g = null;
      listen(null);
      if (!d?.turn) return;
      cancelAnimationFrame(frame);
      frame = 0;
      settling = true;
      const side = -d.dir!; // the way the old page (or date) leaves
      const done = Math.abs(d.off) > d.w / 3 ? d.v * side > -0.3 : d.v * side > 0.4;
      const left = done ? d.w - Math.abs(d.off) : Math.abs(d.off);
      const ms = Math.round(Math.max(140, Math.min(280, left * 0.85)));
      // Done, a date's copy only needs to go halfway, as it's faded out by then.
      place(d, done ? side * d.w * (d.turn.slide ? 0.5 : 1) : 0, ms);
      if (d.turn.slide && done) style(d.cover!, `translateX(${side * d.w * 0.5}px)`, "0", ms);
      setTimeout(() => {
        if (!done) d.turn!.undo();
        // Back to as it was once the undone page is drawn under the copy.
        setTimeout(() => {
          d.cover!.remove();
          style(current(), "", "", 0);
          settling = false;
        }, done ? 0 : 80);
      }, ms + 20);
    }
    el.addEventListener("touchstart", down, { passive: true });
    return () => {
      el.removeEventListener("touchstart", down);
      listen(null);
    };
  }, [ref, main, page]);
}

export function Shell({ children }: { children: ReactNode }) {
  const [loc, nav] = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const pages = useNav();
  const page = pages.findIndex((n) => n.match(loc));
  const pageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  // Dragging the bottom bar (or just above it) goes to the next or previous page in it (in the user's
  // order; the end pages go no further). Dragging a page steps its date, pressing its own next or
  // previous day (week, month) button, marked `data-swipe`; a page with no dates goes to the next page instead.
  const plan = (dir: 1 | -1, startY: number): Turn | null => {
    const main = mainRef.current, bar = barRef.current;
    if (!main) return null;
    const onPage = !bar?.offsetHeight || startY < bar.getBoundingClientRect().top - BAR_REACH;
    const stepSel = `[data-swipe="${dir > 0 ? "next" : "prev"}"]:not(:disabled)`;
    const before = window.location.hash;
    // Back the way it came: through history if the change moved there, else (a date the page keeps
    // itself, like the calendar's) its other step button.
    const undo = () => (window.location.hash !== before ? window.history.back()
      : main.querySelector<HTMLButtonElement>(`[data-swipe="${dir > 0 ? "prev" : "next"}"]`)?.click());
    if (onPage && main.querySelector(stepSel)) return { change: () => main.querySelector<HTMLButtonElement>(stepSel)?.click(), undo, slide: true };
    if (onPage && main.querySelector("[data-swipe]")) return null; // dates, but none further that way
    const next = page < 0 ? undefined : pages[page + dir];
    return next ? { change: () => nav(next.href), undo } : null;
  };
  usePageDrag(mainRef, mainRef, pageRef, plan);
  usePageDrag(barRef, mainRef, pageRef, plan);
  const { settings } = useSettings();
  const { focus } = usePlanner();
  const elapsed = useFocusElapsed();
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
        <main ref={mainRef} className="relative flex-1 min-w-0 flex flex-col overflow-hidden pb-[calc(3.5rem+var(--safe-bottom,env(safe-area-inset-bottom,0px)))] md:pb-0">
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
              onClick={(ev) => {
                const to = pages.indexOf(n), main = mainRef.current, el = pageRef.current;
                if (on || page < 0 || to === page || !main || !el || ev.metaKey || ev.ctrlKey) return;
                ev.preventDefault();
                turnPage(main, el, to > page ? 1 : -1, () => nav(n.href));
              }}
              className={cn("flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2 text-[12px]", on || timer ? "text-primary font-semibold" : "text-muted-foreground")}
              aria-current={on ? "page" : undefined}
              data-testid={`link-mnav-${n.label.toLowerCase()}`}
            >
              <span className={cn("grid h-7 w-11 place-items-center rounded-full transition-colors", on && "bg-primary/10")}>
                <n.icon className="h-5 w-5" />
              </span>
              <span className="truncate max-w-full tnum">{timer ? clock(focus.plannedSec - elapsed) : n.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="grid gap-3 px-4 md:px-6 pt-5 md:pt-7 pb-1">
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
