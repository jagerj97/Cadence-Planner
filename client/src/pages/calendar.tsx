import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/shell";
import { DayColumn, HourLabels } from "@/components/timeline";
import { usePlanner } from "@/components/planner";
import { useItems, useSettings } from "@/lib/data";
import type { Item } from "@shared/schema";
import {
  DAY_SHORT,
  addDays,
  blocksForDay,
  colorOf,
  fmtDate,
  fmtTime,
  kindOf,
  parseYmd,
  recOf,
  routineSchedules,
  startOfWeek,
  toMin,
  todayStr,
  untimedForDay,
  ymd,
} from "@/lib/cal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const WEEK_HOUR = 48;

type CalendarGroup = "habits" | "tasks" | "events" | "routines" | "focus";
type CalendarVisibility = Record<CalendarGroup, boolean>;
const ALL_VISIBLE: CalendarVisibility = { habits: false, tasks: true, events: true, routines: false, focus: true };
let lastVisibility: CalendarVisibility = ALL_VISIBLE;

function groupOf(item: Item): CalendarGroup {
  switch (kindOf(item)) {
    case "habit": return "habits";
    case "task": return "tasks";
    case "event":
    case "meeting": return "events";
    case "sleep": return "routines";
    case "focus": return "focus";
  }
}

const FILTERS: { key: CalendarGroup; label: string; color: string }[] = [
  { key: "habits", label: "Habits", color: "hsl(var(--k-habit))" },
  { key: "tasks", label: "Tasks", color: "hsl(var(--k-task))" },
  { key: "events", label: "Events", color: "hsl(var(--k-event))" },
  { key: "routines", label: "Routines", color: "hsl(var(--k-sleep))" },
  { key: "focus", label: "Focus", color: "hsl(var(--k-focus))" },
];

export function WeekPage({ toggle, filters, visibility = ALL_VISIBLE }: { toggle?: ReactNode; filters?: ReactNode; visibility?: CalendarVisibility }) {
  const { data: items } = useItems();
  const { settings } = useSettings();
  const { openDetails } = usePlanner();
  const [, nav] = useLocation();
  const [anchor, setAnchor] = useState(todayStr());
  const start = startOfWeek(anchor, settings.weekStartsOn);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const list = (items ?? []).filter((i) => visibility[groupOf(i)]);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, []);
  const end = days[6];
  const title =
    parseYmd(start).getMonth() === parseYmd(end).getMonth()
      ? fmtDate(start, { month: "long", year: "numeric" })
      : `${fmtDate(start, { month: "short" })} – ${fmtDate(end, { month: "short", year: "numeric" })}`;

  return (
    <>
      <PageHeader title={<WeekPicker title={title} start={start} weekStartsOn={settings.weekStartsOn} onPick={setAnchor} />} sub={`Week of ${fmtDate(start, { month: "short", day: "numeric" })}`}>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setAnchor(addDays(anchor, -7))} aria-label="Previous week" data-testid="button-prev-week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(todayStr())} data-testid="button-this-week">
            This week
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setAnchor(addDays(anchor, 7))} aria-label="Next week" data-testid="button-next-week">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {toggle}
      </PageHeader>
      {filters}
      <div className="flex-1 min-h-0 p-4 md:p-6">
        <div className="h-full card-md flex flex-col overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col min-h-0">
            <div className="min-w-0 flex flex-col flex-1 min-h-0">
              {/* header */}
              <div className="flex border-b">
                <div className="w-9 sm:w-14 shrink-0" />
                {days.map((d) => {
                  const today = d === todayStr();
                  const untimed = untimedForDay(list, d);
                  return (
                    <div key={d} className="flex-1 min-w-0 border-l px-0.5 sm:px-1.5 py-2">
                      <button
                        onClick={() => nav(d === todayStr() ? "/" : `/day/${d}`)}
                        className="flex w-full flex-col sm:flex-row items-center gap-0 sm:gap-1.5 rounded sm:px-1 hover-elevate"
                        aria-label={fmtDate(d, { weekday: "long", month: "short", day: "numeric" })}
                        data-testid={`link-day-${d}`}
                      >
                        <span className="text-[11px] sm:text-xs text-muted-foreground"><span className="sm:hidden">{DAY_SHORT[parseYmd(d).getDay()].slice(0, 1)}</span><span className="hidden sm:inline">{DAY_SHORT[parseYmd(d).getDay()]}</span></span>
                        <span
                          className={cn(
                            "text-[12px] sm:text-sm font-semibold tnum",
                            today && "rounded-full bg-primary text-primary-foreground px-1 sm:px-1.5",
                          )}
                        >
                          {parseYmd(d).getDate()}
                        </span>
                      </button>
                      <div className="mt-1 grid gap-0.5 min-h-[20px]">
                        {untimed.slice(0, 2).map((i) => (
                          <button
                            key={i.id}
                            onClick={() => openDetails(i, d)}
                            aria-label={i.title}
                            className="h-2.5 sm:h-auto min-w-0 truncate rounded px-0.5 sm:px-1 text-left text-xs"
                            style={{ background: `color-mix(in srgb, ${colorOf(i)} 15%, transparent)` }}
                          >
                            <span className="block sm:hidden h-1.5 w-full rounded-full" style={{ background: colorOf(i) }} aria-hidden />
                            <span className="hidden sm:inline">{i.title}</span>
                          </button>
                        ))}
                        {untimed.length > 2 && <span className="text-[10px] sm:text-xs text-muted-foreground px-0.5 sm:px-1">+{untimed.length - 2}<span className="hidden sm:inline"> more</span></span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div ref={scroller} className="flex-1 overflow-y-auto scroll-thin">
                <div className="flex pt-2 pb-2">
                  <HourLabels hourPx={WEEK_HOUR} narrow />
                  {days.map((d) => (
                    <div key={d} className="flex-1 min-w-0 border-l flex">
                      <DayColumn
                        day={d}
                        items={list}
                        hourPx={WEEK_HOUR}
                        compact
                        showRoutines={visibility.routines}
                        wakeMin={toMin(settings.wakeTime)}
                        bedMin={toMin(settings.bedTime)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function MonthPage({ toggle, filters, visibility = ALL_VISIBLE }: { toggle?: ReactNode; filters?: ReactNode; visibility?: CalendarVisibility }) {
  const { data: items } = useItems();
  const { settings } = useSettings();
  const { openDetails } = usePlanner();
  const [, nav] = useLocation();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const first = parseYmd(month);
  const gridStart = startOfWeek(month, settings.weekStartsOn);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const list = (items ?? []).filter((i) => visibility[groupOf(i)]);
  const shift = (n: number) => {
    const next = ymd(new Date(first.getFullYear(), first.getMonth() + n, 1));
    setMonth(next);
  };
  const weekdays = Array.from({ length: 7 }, (_, i) => DAY_SHORT[(i + settings.weekStartsOn) % 7]);

  return (
    <>
      <PageHeader title={<MonthPicker month={month} onPick={setMonth} />}>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => shift(-1)} aria-label="Previous month" data-testid="button-prev-month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const d = new Date();
              setMonth(ymd(new Date(d.getFullYear(), d.getMonth(), 1)));
            }}
            data-testid="button-this-month"
          >
            This month
          </Button>
          <Button size="icon" variant="ghost" onClick={() => shift(1)} aria-label="Next month" data-testid="button-next-month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {toggle}
      </PageHeader>
      {filters}
      <div className="flex-1 min-h-0 p-4 md:p-6 overflow-y-auto md:overflow-auto">
        <div className="card-md flex overflow-hidden min-w-0 h-full flex-col">
          <div className="grid grid-cols-7 border-b">
            {weekdays.map((w) => (
              <div key={w} className="min-w-0 px-0 sm:px-2 py-2 text-center sm:text-left text-[11px] sm:text-xs font-medium text-muted-foreground">
                <span className="sm:hidden">{w.slice(0, 1)}</span><span className="hidden sm:inline">{w}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 grid-rows-6 flex-1">
            {cells.map((d, idx) => {
              const inMonth = parseYmd(d).getMonth() === first.getMonth();
              const today = d === todayStr();
              const timed = blocksForDay(list, d)
                .filter((b, index, blocks) => blocks.findIndex((other) => other.item.id === b.item.id) === index)
                .map((b) => ({ i: b.item, t: b.continues === "before" || b.continues === "through" ? null : b.item.startTime }));
              const untimed = untimedForDay(list, d).map((i) => ({ i, t: null as string | null }));
              const routines = visibility.routines
                ? blocksForDay(routineSchedules(settings), d)
                  .filter((b, index, blocks) => blocks.findIndex((other) => other.item.id === b.item.id) === index)
                : [];
              const all = [...untimed, ...timed].sort(
                (a, b) => Number(recOf(a.i).freq !== "none") - Number(recOf(b.i).freq !== "none") || Number(!a.i.allDay) - Number(!b.i.allDay) || (a.t || "").localeCompare(b.t || ""),
              );
              return (
                <div
                  key={d}
                  className={cn("min-w-0 min-h-[66px] sm:min-h-[96px] border-t border-l p-0.5 sm:p-1.5 flex flex-col gap-0.5", idx % 7 === 0 && "border-l-0", idx < 7 && "border-t-0", !inMonth && "bg-muted/40")}
                  data-testid={`cell-month-${d}`}
                >
                  <button
                    onClick={() => nav(today ? "/" : `/day/${d}`)}
                    className={cn(
                      "self-center sm:self-start text-[12px] sm:text-xs font-semibold tnum rounded-full h-5 min-w-5 sm:h-6 sm:min-w-6 px-0.5 sm:px-1.5 hover-elevate",
                      today ? "bg-primary text-primary-foreground" : inMonth ? "" : "text-muted-foreground",
                    )}
                    aria-label={fmtDate(d)}
                  >
                    {parseYmd(d).getDate()}
                  </button>
                  {routines.slice(0, 2).map((b) => (
                    <div
                      key={b.item.id}
                      role="img"
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`${b.item.title} routine, ${fmtDate(d)}`}
                      className="flex h-3.5 sm:h-auto items-center gap-0.5 rounded px-0.5 sm:px-1 text-left text-[9px] sm:text-xs leading-none min-w-0 select-none"
                      style={{ background: `color-mix(in srgb, ${colorOf(b.item)} 13%, transparent)`, color: colorOf(b.item) }}
                      data-testid={`routine-month-${d}-${b.item.id}`}
                    >
                      <span className="h-2.5 w-0.5 shrink-0 rounded-full" style={{ background: colorOf(b.item) }} />
                      <span className="truncate">{b.item.title}</span>
                    </div>
                  ))}
                  {routines.length > 2 && <span className="text-[10px] text-muted-foreground">+{routines.length - 2} routines</span>}
                  {all.slice(0, 3).map(({ i, t }) => (
                    <button
                      key={i.id + (t || "")}
                      onClick={() => openDetails(i, d)}
                      aria-label={`${i.title}${t ? `, ${fmtTime(t, true)}` : ""}`}
                      className="flex h-3.5 sm:h-auto items-center gap-0.5 sm:gap-1 rounded px-0.5 sm:px-1 text-left text-[9px] sm:text-xs leading-none sm:leading-normal hover-elevate min-w-0 overflow-hidden"
                      style={{ background: `color-mix(in srgb, ${colorOf(i)} 15%, transparent)` }}
                    >
                      <span className="h-2.5 w-0.5 sm:h-1.5 sm:w-1.5 rounded-full shrink-0" style={{ background: colorOf(i) }} />
                      {t && <span className="hidden sm:inline text-muted-foreground tnum shrink-0">{fmtTime(t, true)}</span>}
                      <span className="block min-w-0 truncate whitespace-nowrap">{i.title}</span>
                    </button>
                  ))}
                  {all.length > 3 && (
                    <button onClick={() => nav(`/day/${d}`)} className="text-center sm:text-left text-[10px] sm:text-xs text-muted-foreground px-0.5 sm:px-1 hover:text-foreground">
                      +{all.length - 3}<span className="hidden sm:inline"> more</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- Calendar tab: swaps between week and month ---------- */
type CalView = "week" | "month";
let lastView: CalView = "month"; // remembered while the app is open
export function CalendarPage() {
  const [loc] = useLocation();
  const [view, setView] = useState<CalView>(() => (loc.startsWith("/month") ? "month" : loc.startsWith("/week") ? "week" : lastView));
  const [visibility, setVisibility] = useState<CalendarVisibility>(() => ({ ...lastVisibility }));
  const pick = (v: CalView) => {
    lastView = v;
    setView(v);
  };
  const flip = (key: CalendarGroup) => {
    setVisibility((current) => {
      const next = { ...current, [key]: !current[key] };
      lastVisibility = next;
      return next;
    });
  };
  const filters = (
    <div className="flex flex-wrap gap-1.5 px-4 md:px-6 pt-3" role="group" aria-label="Show in calendar">
      {FILTERS.map(({ key, label, color }) => {
        const on = visibility[key];
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => flip(key)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12px] sm:text-xs font-medium transition-opacity",
              on ? "text-foreground" : "bg-card text-muted-foreground opacity-55",
            )}
            style={on ? { background: `color-mix(in srgb, ${color} 12%, hsl(var(--card)))`, borderColor: `color-mix(in srgb, ${color} 35%, hsl(var(--border)))` } : undefined}
            title={key === "events" ? "Events and meetings, including imported calendars" : undefined}
            data-testid={`toggle-calendar-${key}`}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: on ? color : "hsl(var(--muted-foreground))" }} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
  const toggle = (
    <div className="ml-auto flex rounded-full border bg-card p-0.5" role="tablist" aria-label="Calendar view">
      {(["week", "month"] as CalView[]).map((v) => (
        <button
          key={v}
          role="tab"
          aria-selected={view === v}
          onClick={() => pick(v)}
          className={cn(
            "h-8 px-4 rounded-full text-xs font-medium transition-colors",
            view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
          data-testid={`tab-view-${v}`}
        >
          {v}
        </button>
      ))}
    </div>
  );
  return view === "week"
    ? <WeekPage toggle={toggle} filters={filters} visibility={visibility} />
    : <MonthPage toggle={toggle} filters={filters} visibility={visibility} />;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Page title that opens a jump-to picker. */
function PickerTitle({ label, open, onOpenChange, children, testId }: {
  label: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode; testId: string;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex max-w-full items-center gap-1 rounded-md -mx-1 px-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`${label}. Choose a different date`} data-testid={testId}>
          <span className="truncate">{label}</span>
          <ChevronDown className={cn("h-5 w-5 md:h-6 md:w-6 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} strokeWidth={2.5} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">{children}</PopoverContent>
    </Popover>
  );
}

function StepHeader({ label, onPrev, onNext, unit }: { label: string; onPrev: () => void; onNext: () => void; unit: string }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onPrev} aria-label={`Previous ${unit}`} data-testid={`button-picker-prev-${unit}`}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm font-semibold tnum">{label}</span>
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onNext} aria-label={`Next ${unit}`} data-testid={`button-picker-next-${unit}`}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function MonthPicker({ month, onPick }: { month: string; onPick: (firstOfMonth: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = parseYmd(month);
  const [year, setYear] = useState(current.getFullYear());
  useEffect(() => { if (open) setYear(current.getFullYear()); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = new Date();
  return (
    <PickerTitle label={fmtDate(month, { month: "long", year: "numeric" })} open={open} onOpenChange={setOpen} testId="button-pick-month">
      <StepHeader label={String(year)} unit="year" onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} />
      <div className="grid grid-cols-3 gap-1.5">
        {MONTHS_SHORT.map((name, m) => {
          const selected = year === current.getFullYear() && m === current.getMonth();
          const isNow = year === now.getFullYear() && m === now.getMonth();
          return (
            <button key={name} type="button"
              onClick={() => { onPick(ymd(new Date(year, m, 1))); setOpen(false); }}
              className={cn("rounded-md py-2 text-sm font-medium transition-colors",
                selected ? "bg-primary text-primary-foreground" : isNow ? "text-primary ring-1 ring-primary/50 hover:bg-muted" : "hover:bg-muted")}
              aria-pressed={selected} data-testid={`button-pick-month-${m + 1}`}>
              {name}
            </button>
          );
        })}
      </div>
    </PickerTitle>
  );
}

function WeekPicker({ title, start, weekStartsOn, onPick }: {
  title: string; start: string; weekStartsOn: 0 | 1; onPick: (day: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const firstOf = (d: string) => { const x = parseYmd(d); return new Date(x.getFullYear(), x.getMonth(), 1); };
  // Show the month containing most of the selected week (its middle day).
  const [view, setView] = useState(() => firstOf(addDays(start, 3)));
  useEffect(() => { if (open) setView(firstOf(addDays(start, 3))); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthStart = ymd(view);
  const monthEnd = ymd(new Date(view.getFullYear(), view.getMonth() + 1, 0));
  const weeks: string[] = [];
  for (let w = startOfWeek(monthStart, weekStartsOn); w <= monthEnd; w = addDays(w, 7)) weeks.push(w);
  const thisWeek = startOfWeek(todayStr(), weekStartsOn);
  const range = (w: string) => {
    const e = addDays(w, 6);
    const sameMonth = parseYmd(w).getMonth() === parseYmd(e).getMonth();
    return `${fmtDate(w, { month: "short", day: "numeric" })} – ${sameMonth ? parseYmd(e).getDate() : fmtDate(e, { month: "short", day: "numeric" })}`;
  };
  return (
    <PickerTitle label={title} open={open} onOpenChange={setOpen} testId="button-pick-week">
      <StepHeader label={fmtDate(monthStart, { month: "long", year: "numeric" })} unit="month"
        onPrev={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
        onNext={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} />
      <div className="grid gap-1">
        {weeks.map((w) => {
          const selected = w === start;
          return (
            <button key={w} type="button"
              onClick={() => { onPick(w); setOpen(false); }}
              className={cn("flex items-center justify-between rounded-md px-3 py-2 text-sm tnum transition-colors",
                selected ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-muted")}
              aria-pressed={selected} data-testid={`button-pick-week-${w}`}>
              <span>{range(w)}</span>
              {w === thisWeek && <span className={cn("text-xs", selected ? "opacity-90" : "text-primary font-medium")}>This week</span>}
            </button>
          );
        })}
      </div>
    </PickerTitle>
  );
}
