import { useEffect, useState, type ReactNode } from "react";
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
import { fromMin, toMin, todayStr } from "@/lib/cal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Kind } from "@shared/schema";
import { QuickAdd } from "@/pages/today";
import { cn } from "@/lib/utils";

export function Logo({ className = "h-7 w-7", onBar = false }: { className?: string; onBar?: boolean }) {
  const bg = onBar ? "hsl(var(--appbar-fg))" : "hsl(var(--primary))";
  const fg = onBar ? "hsl(var(--primary))" : "hsl(var(--primary-foreground))";
  return (
    <svg viewBox="0 0 32 32" className={className} aria-label="Cadence" role="img" fill="none">
      <rect width="32" height="32" rx="7" fill={bg} />
      <path d="M22.5 9.5A9 9 0 1 0 22.5 22.5" stroke={fg} strokeWidth="3" strokeLinecap="round" />
      <circle cx="23" cy="16" r="2.4" fill={fg} />
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Today", icon: Home, match: (l: string) => l === "/" || l.startsWith("/day") },
  { href: "/calendar", label: "Calendar", icon: CalendarRange, match: (l: string) => /^\/(calendar|week|month)/.test(l) },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, match: (l: string) => l.startsWith("/tasks") },
  { href: "/habits", label: "Habits", icon: Repeat, match: (l: string) => l.startsWith("/habits") },
  { href: "/journal", label: "Journal", icon: NotebookPen, match: (l: string) => l.startsWith("/journal") },
  { href: "/focus", label: "Focus", icon: Timer, match: (l: string) => l.startsWith("/focus") },
];
const SETTINGS_NAV = { href: "/settings", label: "Settings", icon: SettingsIcon, match: (l: string) => l.startsWith("/settings") || l.startsWith("/sync") };

function DrawerLinks({ onNavigate }: { onNavigate?: () => void }) {
  const [loc] = useLocation();
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
        {NAV.map(row)}
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

function AddMenu() {
  const [open, setOpen] = useState(false);
  const [loc, nav] = useLocation();
  const { openEditor } = usePlanner();
  const day = loc.startsWith("/day/") ? loc.slice(5) : todayStr();
  useEffect(() => setOpen(false), [loc]);

  const pick = (kind: Kind | "journal") => {
    setOpen(false);
    if (kind === "journal") {
      nav("/journal");
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn("grid h-11 w-11 place-items-center rounded-full text-[hsl(var(--appbar-fg))] hover:bg-black/5 dark:hover:bg-white/10 transition-colors", open && "bg-black/10 dark:bg-white/15")}
          aria-label="Add something"
          aria-expanded={open}
          data-testid="button-add"
        >
          <Plus className="h-6 w-6" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,440px)] p-0 rounded shadow-lg">
        <div className="p-3 border-b">
          <QuickAdd appbar day={day} onDone={() => setOpen(false)} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-2">
          {ADD_KINDS.map((k) => (
            <button
              key={k.kind}
              onClick={() => pick(k.kind)}
              className="flex items-center gap-3 rounded px-3 py-2.5 text-sm hover:bg-muted text-left"
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

let lastPage = "/"; // where the gear returns to when leaving Settings

export function Shell({ children }: { children: ReactNode }) {
  const [loc, nav] = useLocation();
  const { focus, elapsed } = usePlanner();
  const inSettings = SETTINGS_NAV.match(loc);
  if (!inSettings) lastPage = loc;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      {/* app bar: settings + add, nothing else */}
      <header className="appbar relative z-30 flex h-14 md:h-16 shrink-0 items-center justify-between px-3 md:px-5">
        <button
          onClick={() => nav(inSettings ? lastPage : "/settings")}
          className={cn("grid h-11 w-11 place-items-center rounded-full text-[hsl(var(--appbar-fg))] hover:bg-black/5 dark:hover:bg-white/10 transition-transform duration-300", inSettings && "bg-black/10 dark:bg-white/15 rotate-90")}
          aria-label={inSettings ? "Close settings" : "Settings"}
          aria-pressed={inSettings}
          data-testid="button-settings"
        >
          {inSettings ? <X className="h-6 w-6 -rotate-90" /> : <SettingsIcon className="h-6 w-6" />}
        </button>
        <AddMenu />
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="wellness-rail hidden md:flex w-56 shrink-0 flex-col overflow-y-auto bg-sidebar border-r z-20">
          <DrawerLinks />
        </aside>
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden pb-14 md:pb-0">{children}</main>
      </div>

      {/* bottom bar (phones) */}
      <nav className="wellness-bottom md:hidden fixed bottom-0 inset-x-0 z-40 flex px-1 pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        {NAV.map((n) => {
          const on = n.match(loc);
          const timer = n.href === "/focus" && focus;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn("flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2 text-[11px]", on || timer ? "text-primary font-semibold" : "text-muted-foreground")}
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
        <h1 className="text-[25px] md:text-[30px] font-semibold tracking-tight leading-tight truncate" data-testid="text-page-title">
          {title}
        </h1>
        {sub && <div className="text-sm text-muted-foreground">{sub}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
