import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Home,
  CalendarRange,
  NotebookPen,
  CheckSquare as TaskIcon,
  Calendar as EventIcon,
  Users,
  Target,
  Repeat,
  Timer,
  CheckSquare,
  Settings as SettingsIcon,
  Plus,
  X,
} from "lucide-react";
import { usePlanner, clock } from "./planner";
import { fromMin, todayStr } from "@/lib/cal";
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
  const { focus, elapsed } = usePlanner();
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

const ADD_KINDS: { kind: Kind | "journal"; label: string; icon: typeof Home; color: string }[] = [
  { kind: "task", label: "Task", icon: TaskIcon, color: "hsl(var(--k-task))" },
  { kind: "event", label: "Event", icon: EventIcon, color: "hsl(var(--k-event))" },
  { kind: "meeting", label: "Meeting", icon: Users, color: "hsl(var(--k-meeting))" },
  { kind: "habit", label: "Habit", icon: Repeat, color: "hsl(var(--k-habit))" },
  { kind: "focus", label: "Focus", icon: Target, color: "hsl(var(--k-focus))" },
];

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
      setTimeout(() => window.dispatchEvent(new Event("cadence:journal-compose")), 80);
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
        className="grid h-11 w-11 place-items-center rounded-full text-[hsl(var(--appbar-fg))] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
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
          className={cn("grid h-11 w-11 place-items-center rounded-full text-[hsl(var(--appbar-fg))] hover:bg-black/5 dark:hover:bg-white/10 transition-colors", open && "bg-black/10 dark:bg-white/15")}
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

/**
 * Swiping left or right across a page goes to the next or previous page in the bar (in the user's
 * order); the end pages go no further. Holds (which pick items up to drag them) and mostly-vertical moves are left alone.
 */
function usePageSwipe(main: React.RefObject<HTMLElement>, loc: string, nav: (typeof NAV)[number][], go: (href: string, dir: 1 | -1) => void) {
  const locRef = useRef(loc);
  locRef.current = loc;
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    let start: { x: number; y: number; t: number } | null = null;
    const down = (e: TouchEvent) => {
      start = e.touches.length === 1 && !sidewaysOwner(e.target, el) ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
    };
    const move = (e: TouchEvent) => { if (e.touches.length > 1 || e.defaultPrevented) start = null; };
    const up = (e: TouchEvent) => {
      const s = start;
      start = null;
      const t = e.changedTouches[0];
      if (!s || !t || Date.now() - s.t > 700) return;
      const dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
      const pages = navRef.current;
      const at = pages.findIndex((n) => n.match(locRef.current));
      if (at < 0) return;
      const dir = dx < 0 ? 1 : -1;
      const next = pages[at + dir];
      if (next) go(next.href, dir);
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    el.addEventListener("touchend", up, { passive: true });
    el.addEventListener("touchcancel", () => { start = null; }, { passive: true });
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
    };
  }, [main, go]);
}

export function Shell({ children }: { children: ReactNode }) {
  const [loc, nav] = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const pages = useNav();
  const page = pages.findIndex((n) => n.match(loc));
  // The page a swipe brings in slides in from that side.
  const [slide, setSlide] = useState<{ dir: 1 | -1; to: string } | null>(null);
  const go = useCallback((href: string, dir: 1 | -1) => {
    setSlide({ dir, to: href });
    nav(href);
    setTimeout(() => setSlide(null), 300);
  }, [nav]);
  usePageSwipe(mainRef, loc, pages, go);
  const slid = slide && pages[page]?.href === slide.to ? slide.dir : 0;
  const { focus, elapsed } = usePlanner();
  const { settings } = useSettings();
  const inSettings = SETTINGS_NAV.match(loc);
  if (!inSettings) lastPage = loc;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      {/* app bar: settings + add, nothing else */}
      {/* Runs up behind the phone's status bar (--safe-top), carrying its color and wash with it. */}
      <header className="appbar relative z-30 box-content flex h-14 md:h-16 shrink-0 items-center justify-between px-3 md:px-5 pt-[var(--safe-top,env(safe-area-inset-top,0px))]">
        <button
          onClick={() => nav(inSettings ? lastPage : "/settings")}
          className={cn("grid h-11 w-11 place-items-center rounded-full text-[hsl(var(--appbar-fg))] hover:bg-black/5 dark:hover:bg-white/10 transition-transform duration-300", inSettings && "bg-black/10 dark:bg-white/15 rotate-90")}
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
        <main ref={mainRef} className="flex-1 min-w-0 flex flex-col overflow-hidden pb-14 md:pb-0">
          <div key={page}
            className={cn("flex flex-1 min-h-0 flex-col", slid !== 0 && "animate-in fade-in duration-200", slid > 0 ? "slide-in-from-right-8" : slid < 0 && "slide-in-from-left-8")}>
            {children}
          </div>
        </main>
      </div>

      {/* bottom bar (phones) */}
      <nav className="wellness-bottom md:hidden fixed bottom-0 inset-x-0 z-40 flex px-1 pb-[env(safe-area-inset-bottom)]" aria-label="Main">
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
