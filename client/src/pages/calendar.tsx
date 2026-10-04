import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/shell";
import { DayColumn, HourLabels } from "@/components/timeline";
import { usePlanner } from "@/components/planner";
import { useItems, useSettings } from "@/lib/data";
import type { Item, WeekDay } from "@shared/schema";
import {
  DAY_SHORT,
  addDays,
  barsFor,
  dayDiff,
  isLong,
  isTimed,
  lastDayOffset,
  type Bar,
  blocksForDay,
  colorOf,
  fmtDate,
  fmtTime,
  kindOf,
  parseYmd,
  recOf,
  startOfWeek,
  toMin,
  todayStr,
  untimedForDay,
  ymd,
} from "@/lib/cal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { accentOf } from "@/components/taskTags";
import { AgendaList } from "@/components/agendaList";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const WEEK_HOUR = 60;
/** Lines of items a month day shows before "+N more". */
const MONTH_LINES = 3;

/** Covers a whole grid row, so the bars in it are placed against the row rather than a cell. */
function BarLayer({ children }: { children: ReactNode }) {
  return <div className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>{children}</div>;
}

/**
 * An item over several days, drawn once across them. Square ends where it carries on past the days
 * shown. Its left and right sit inside the day cells' padding (--pad) unless it continues.
 */
function SpanBar({ bar, days, className, style, onOpen }: {
  bar: Bar; days: number; className?: string; style?: React.CSSProperties; onOpen: () => void;
}) {
  const { settings } = useSettings();
  const i = bar.item;
  const time = isTimed(i) && !bar.before ? i.startTime : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${i.title}${time ? `, ${fmtTime(time, true)}` : ""}, ${fmtDate(bar.occ, { month: "short", day: "numeric" })} to ${fmtDate(addDays(bar.occ, lastDayOffset(i)), { month: "short", day: "numeric" })}`}
      // Not hover-elevate: it makes the element position: relative, which would undo the placement.
      className={cn("absolute z-[1] flex items-center gap-0.5 sm:gap-1 overflow-hidden rounded px-0.5 sm:px-1 text-left leading-none hover:brightness-125",
        bar.before && "rounded-l-none", bar.after && "rounded-r-none", className)}
      style={{
        left: `calc(${(bar.from / days) * 100}% + ${bar.before ? "0px" : "var(--pad)"})`,
        width: `calc(${((bar.to - bar.from + 1) / days) * 100}% - ${bar.before ? "0px" : "var(--pad)"} - ${bar.after ? "0px" : "var(--pad)"})`,
        background: `color-mix(in srgb, ${colorOf(i)} 22%, hsl(var(--card)))`,
        ...style,
      }}
      data-testid={`bar-${i.id}-${bar.occ}`}
    >
      <span className="h-2.5 w-0.5 sm:h-1.5 sm:w-1.5 rounded-full shrink-0" style={{ background: accentOf(i, settings) }} />
      {time && <span className="hidden sm:inline text-muted-foreground tnum shrink-0">{fmtTime(time, true)}</span>}
      <span className="block min-w-0 truncate whitespace-nowrap">{i.title}</span>
    </button>
  );
}

type CalendarGroup = "habits" | "tasks" | "events" | "focus";
type CalendarVisibility = Record<CalendarGroup, boolean>;
const ALL_VISIBLE: CalendarVisibility = { habits: false, tasks: true, events: true, focus: true };
let lastVisibility: CalendarVisibility = ALL_VISIBLE;

/** Routines (sleep and other background time) aren't shown on the calendar. */
function groupOf(item: Item): CalendarGroup | null {
  switch (kindOf(item)) {
    case "habit": return "habits";
    case "task": return "tasks";
    case "event":
    case "meeting": return "events";
    case "sleep": return null;
    case "focus": return "focus";
  }
}

const FILTERS: { key: CalendarGroup; label: string; color: string }[] = [
  { key: "habits", label: "Habits", color: "hsl(var(--k-habit))" },
  { key: "tasks", label: "Tasks", color: "hsl(var(--k-task))" },
  { key: "events", label: "Events", color: "hsl(var(--k-event))" },
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
  const list = (items ?? []).filter((i) => { const group = groupOf(i); return group !== null && visibility[group]; });
  const weekBars = barsFor(list, start, 7);
  // Items a day or longer are bars in the header instead of blocks in the hours.
  const gridList = list.filter((i) => !(isTimed(i) && isLong(i)));
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
      <div className="flex-1 min-h-0 pt-3 md:p-6">
        <div className="h-full card-md card-flush flex flex-col overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col min-h-0">
            <div className="min-w-0 flex flex-col flex-1 min-h-0">
              {/* header: the days, a bar for each item over several days, then each day's other all-day items */}
              <div className="border-b [--lane:20px] [--pad:2px] sm:[--lane:22px] sm:[--pad:6px]">
                <div className="flex">
                  <div className="w-9 sm:w-14 shrink-0" />
                  {days.map((d) => {
                    const today = d === todayStr();
                    return (
                      <div key={d} className="flex-1 min-w-0 border-l px-0.5 sm:px-1.5 pt-2">
                        <button
                          onClick={() => nav(d === todayStr() ? "/" : `/day/${d}`)}
                          className="flex w-full flex-col sm:flex-row items-center gap-0 sm:gap-1.5 rounded sm:px-1 hover-elevate"
                          aria-label={fmtDate(d, { weekday: "long", month: "short", day: "numeric" })}
                          data-testid={`link-day-${d}`}
                        >
                          <span className="text-xs text-muted-foreground"><span className="sm:hidden">{DAY_SHORT[parseYmd(d).getDay()].slice(0, 1)}</span><span className="hidden sm:inline">{DAY_SHORT[parseYmd(d).getDay()]}</span></span>
                          <span
                            className={cn(
                              "text-[15px] sm:text-sm font-semibold tnum",
                              today && "rounded-full bg-primary text-primary-foreground px-1.5",
                            )}
                          >
                            {parseYmd(d).getDate()}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
                {weekBars.lanes > 0 && (
                  <div className="flex">
                    <div className="w-9 sm:w-14 shrink-0" />
                    <div className="relative grid flex-1 grid-cols-7 pt-1" style={{ height: `calc(${weekBars.lanes} * var(--lane) + 4px)` }} data-testid="week-bars">
                      {days.map((d) => <div key={d} className="border-l" aria-hidden />)}
                      <BarLayer>
                        {weekBars.bars.map((b) => (
                          <SpanBar key={`${b.item.id}:${b.occ}`} bar={b} days={7} className="h-[18px] sm:h-5 text-[11px] sm:text-xs"
                            style={{ top: `calc(4px + ${b.lane} * var(--lane))` }} onOpen={() => openDetails(b.item, b.occ)} />
                        ))}
                      </BarLayer>
                    </div>
                  </div>
                )}
                <div className="flex">
                  <div className="w-9 sm:w-14 shrink-0" />
                  {days.map((d) => {
                    const untimed = untimedForDay(list, d).filter((i) => !isLong(i));
                    return (
                      <div key={d} className="flex-1 min-w-0 border-l px-0.5 sm:px-1.5 pb-2">
                        <div className="mt-1 grid gap-0.5 min-h-[20px]">
                          {untimed.slice(0, 2).map((i) => (
                            <button
                              key={i.id}
                              onClick={() => openDetails(i, d)}
                              aria-label={i.title}
                              className="h-[18px] sm:h-auto min-w-0 truncate rounded px-1 text-left text-[11px] leading-[18px] sm:text-xs"
                              style={{ background: `color-mix(in srgb, ${colorOf(i)} 15%, transparent)`, borderLeft: `2px solid ${accentOf(i, settings)}` }}
                            >
                              {i.title}
                            </button>
                          ))}
                          {untimed.length > 2 && <span className="text-[11px] sm:text-xs text-muted-foreground px-0.5 sm:px-1">+{untimed.length - 2}<span className="hidden sm:inline"> more</span></span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div ref={scroller} className="flex-1 overflow-y-auto scroll-thin">
                <div className="flex pt-2 pb-2">
                  <HourLabels hourPx={WEEK_HOUR} narrow />
                  {days.map((d, n) => (
                    <div key={d} className="flex-1 min-w-0 border-l flex">
                      <DayColumn
                        day={d}
                        items={gridList}
                        // Across the week, an overnight item (or routine) is labelled where it starts; its
                        // morning part carries on unlabelled, except on the first day shown.
                        labelContinued={n === 0}
                        hourPx={WEEK_HOUR}
                        compact
                        showRoutines // routine bands always show in the week view (not in month view)
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
  const list = (items ?? []).filter((i) => { const group = groupOf(i); return group !== null && visibility[group]; });
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
      <div className="flex-1 min-h-0 pt-3 md:p-6 overflow-y-auto md:overflow-auto">
        <div className="card-md card-flush flex overflow-hidden min-w-0 min-h-full flex-col">
          <div className="grid grid-cols-7 border-b">
            {weekdays.map((w) => (
              <div key={w} className="min-w-0 px-0 sm:px-2 py-2 text-center sm:text-left text-xs font-medium text-muted-foreground">
                <span className="sm:hidden">{w.slice(0, 1)}</span><span className="hidden sm:inline">{w}</span>
              </div>
            ))}
          </div>
          {/* Six week rows. An item over several days is one bar across them (lanes at the top of the row);
              the rest are listed in each day. A day shows three lines at most, then "+N more". */}
          <div className="flex flex-1 flex-col">
            {Array.from({ length: 6 }, (_, w) => {
              const week = cells.slice(w * 7, w * 7 + 7);
              const { bars, lanes } = barsFor(list, week[0], 7);
              const shownLanes = Math.min(lanes, MONTH_LINES);
              return (
                <div key={week[0]} className="relative grid flex-1 grid-cols-7 [--lane:20px] [--pad:2px] [--top:30px] sm:[--lane:22px] sm:[--pad:6px] sm:[--top:32px]" data-testid={`row-month-${week[0]}`}>
                  {week.map((d, col) => {
                    const idx = w * 7 + col;
                    const inMonth = parseYmd(d).getMonth() === first.getMonth();
                    const today = d === todayStr();
                    // Overnight items show on the day they start; long ones are bars.
                    const timed = blocksForDay(list, d)
                      .filter((b) => !isLong(b.item) && b.continues !== "before" && b.continues !== "through")
                      .filter((b, index, blocks) => blocks.findIndex((other) => other.item.id === b.item.id) === index)
                      .map((b) => ({ i: b.item, t: b.item.startTime }));
                    const untimed = untimedForDay(list, d).filter((i) => !isLong(i)).map((i) => ({ i, t: null as string | null }));
                    const all = [...untimed, ...timed].sort(
                      (a, b) => Number(recOf(a.i).freq !== "none") - Number(recOf(b.i).freq !== "none") || Number(!a.i.allDay) - Number(!b.i.allDay) || (a.t || "").localeCompare(b.t || ""),
                    );
                    const room = MONTH_LINES - shownLanes;
                    const hidden = Math.max(0, all.length - room) + bars.filter((b) => b.lane >= MONTH_LINES && b.from <= col && col <= b.to).length;
                    return (
                      <div
                        key={d}
                        className={cn("min-w-0 min-h-[92px] sm:min-h-[96px] border-t border-l p-0.5 sm:p-1.5 flex flex-col gap-0.5", idx % 7 === 0 && "border-l-0", idx < 7 && "border-t-0", !inMonth && "bg-muted/40")}
                        data-testid={`cell-month-${d}`}
                      >
                        <button
                          onClick={() => nav(today ? "/" : `/day/${d}`)}
                          className={cn(
                            "self-center sm:self-start text-sm sm:text-xs font-semibold tnum rounded-full h-6 min-w-6 px-1 sm:px-1.5 hover-elevate",
                            today ? "bg-primary text-primary-foreground" : inMonth ? "" : "text-muted-foreground",
                          )}
                          aria-label={fmtDate(d)}
                        >
                          {parseYmd(d).getDate()}
                        </button>
                        {shownLanes > 0 && <div className="shrink-0" style={{ height: `calc(${shownLanes} * var(--lane) - 2px)` }} aria-hidden />}
                        {all.slice(0, room).map(({ i, t }) => (
                          <button
                            key={i.id + (t || "")}
                            onClick={() => openDetails(i, d)}
                            aria-label={`${i.title}${t ? `, ${fmtTime(t, true)}` : ""}`}
                            className="flex h-[18px] sm:h-5 items-center gap-0.5 sm:gap-1 rounded px-0.5 sm:px-1 text-left text-[11px] sm:text-xs leading-none hover-elevate min-w-0 overflow-hidden"
                            style={{ background: `color-mix(in srgb, ${colorOf(i)} 15%, transparent)` }}
                          >
                            <span className="h-2.5 w-0.5 sm:h-1.5 sm:w-1.5 rounded-full shrink-0" style={{ background: accentOf(i, settings) }} />
                            {t && <span className="hidden sm:inline text-muted-foreground tnum shrink-0">{fmtTime(t, true)}</span>}
                            <span className="block min-w-0 truncate whitespace-nowrap">{i.title}</span>
                          </button>
                        ))}
                        {hidden > 0 && (
                          <button onClick={() => nav(`/day/${d}`)} className="text-center sm:text-left text-[11px] sm:text-xs text-muted-foreground px-0.5 sm:px-1 hover:text-foreground">
                            +{hidden}<span className="hidden sm:inline"> more</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <BarLayer>
                    {bars.filter((b) => b.lane < MONTH_LINES).map((b) => (
                      <SpanBar key={`${b.item.id}:${b.occ}`} bar={b} days={7} className="h-[18px] sm:h-5 text-[11px] sm:text-xs"
                        style={{ top: `calc(var(--top) + ${b.lane} * var(--lane))` }} onOpen={() => openDetails(b.item, b.occ)} />
                    ))}
                  </BarLayer>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/** Days drawn before and after today on opening, and how many more load at a time. */
const BEFORE = 14, AHEAD = 45, STEP = 60;

/**
 * The agenda view: every day with something on, as a list (like Google Calendar's). It opens on a
 * few weeks around today and loads more either way as it's scrolled, back as far as the first item. The title is the month in view
 * and opens the month picker to jump to a day; Today comes back to today.
 */
export function AgendaPage({ toggle, filters, visibility = ALL_VISIBLE }: { toggle?: ReactNode; filters?: ReactNode; visibility?: CalendarVisibility }) {
  const { data: items } = useItems();
  const list = useMemo(() => (items ?? []).filter((i) => { const group = groupOf(i); return group !== null && visibility[group]; }), [items, visibility]);
  const today = todayStr();
  // Only a few weeks around today are drawn at first; more load as the list nears either end.
  const around = (day: string) => ({ start: addDays(day, -BEFORE), end: addDays(day, AHEAD) });
  const [range, setRange] = useState(() => around(today));
  // How far back scrolling goes: the earliest item (at most three years).
  const floor = useMemo(() => {
    const limit = addDays(today, -3 * 365);
    const earliest = (items ?? []).reduce((m, i) => (i.date < m ? i.date : m), today);
    return earliest < limit ? limit : earliest;
  }, [items, today]);
  const scroller = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(today);
  const [jump, setJump] = useState<string | null>(today);
  // Scroll to a day (the first shown on or after it), once it's in the list.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!jump || !items || !el) return;
    const rows = [...el.querySelectorAll<HTMLElement>("[data-day]")];
    const row = rows.find((r) => (r.dataset.day ?? "") >= jump) ?? rows[rows.length - 1];
    if (row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - 12;
    setInView(jump);
    setJump(null);
  }, [jump, range, items]);
  // A day outside what's loaded starts a fresh window around it rather than drawing everything between.
  const goTo = (day: string) => {
    if (day < range.start || day > range.end) setRange(around(day));
    setJump(day);
  };
  // Days added above would push the list down, so the scroll moves by however much taller it got.
  const grewFrom = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && grewFrom.current != null) el.scrollTop += el.scrollHeight - grewFrom.current;
    grewFrom.current = null;
  }, [range.start]);
  // The title follows the first day in view.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const row = [...el.querySelectorAll<HTMLElement>("[data-day]")].find((r) => r.getBoundingClientRect().bottom > top + 8);
    if (row?.dataset.day && row.dataset.day !== inView) setInView(row.dataset.day);
  };
  // Nearing either end loads the next two months that way.
  const topEdge = useRef<HTMLDivElement>(null);
  const bottomEdge = useRef<HTMLDivElement>(null);
  const watchEdge = (edge: HTMLDivElement | null, grow: () => void) => {
    if (!edge || !items) return;
    const watch = new IntersectionObserver((seen) => {
      if (seen.some((e) => e.isIntersecting)) grow();
    }, { root: scroller.current, rootMargin: "600px" });
    watch.observe(edge);
    return () => watch.disconnect();
  };
  useEffect(() => watchEdge(bottomEdge.current, () => setRange((r) => ({ ...r, end: addDays(r.end, STEP) }))), [range.end, items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => watchEdge(topEdge.current, () => {
    if (range.start <= floor || jump) return;
    grewFrom.current = scroller.current?.scrollHeight ?? null;
    setRange((r) => { const start = addDays(r.start, -STEP); return { ...r, start: start < floor ? floor : start }; });
  }), [range.start, floor, jump, items]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader title={<DayPicker day={inView} label={fmtDate(inView, { month: "long", year: "numeric" })} onPick={goTo} testId="button-pick-agenda-day" />}>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => goTo(today)} data-testid="button-agenda-today">
            Today
          </Button>
        </div>
        {toggle}
      </PageHeader>
      {filters}
      <div className="flex-1 min-h-0 pt-3 md:p-6">
        <div className="card-md card-flush mx-auto h-full max-w-3xl overflow-hidden">
          <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto p-4 md:p-5 [overflow-anchor:none]" data-testid="agenda-scroller">
            <div className="grid gap-4 pb-4">
              <div ref={topEdge} className="h-px" aria-hidden />
              {items && <AgendaList list={list} from={range.start} days={dayDiff(range.start, range.end) + 1} />}
              <div ref={bottomEdge} className="h-px" aria-hidden />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- Calendar tab: swaps between agenda, week and month ---------- */
type CalView = "agenda" | "week" | "month";
const VIEW_LABEL: Record<CalView, string> = { agenda: "Agenda", week: "Week", month: "Month" };
let lastView: CalView = "month"; // remembered while the app is open
export function CalendarPage() {
  const [loc] = useLocation();
  const [view, setView] = useState<CalView>(() => (loc.startsWith("/month") ? "month" : loc.startsWith("/week") ? "week" : loc.startsWith("/agenda") || loc.startsWith("/schedule") ? "agenda" : lastView));
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
      {(["agenda", "week", "month"] as CalView[]).map((v) => (
        <button
          key={v}
          role="tab"
          aria-selected={view === v}
          onClick={() => pick(v)}
          className={cn(
            "h-8 px-3 sm:px-4 rounded-full text-xs font-medium transition-colors",
            view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
          data-testid={`tab-view-${v}`}
        >
          {VIEW_LABEL[v]}
        </button>
      ))}
    </div>
  );
  return view === "week"
    ? <WeekPage toggle={toggle} filters={filters} visibility={visibility} />
    : view === "agenda"
      ? <AgendaPage toggle={toggle} filters={filters} visibility={visibility} />
      : <MonthPage toggle={toggle} filters={filters} visibility={visibility} />;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Page title that opens a jump-to picker. */
export function PickerTitle({ label, open, onOpenChange, children, testId }: {
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

export function StepHeader({ label, onPrev, onNext, unit }: { label: string; onPrev: () => void; onNext: () => void; unit: string }) {
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
  title: string; start: string; weekStartsOn: WeekDay; onPick: (day: string) => void;
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

/** A page's date title (Today, Journal) that opens a month calendar to jump to a day; `marked` days (the journal's with entries) get a small dot. */
export function DayPicker({ day, label, marked, onPick, testId = "button-pick-journal-day" }: {
  day: string; label: string; marked?: Set<string>; onPick: (d: string) => void; testId?: string;
}) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const firstOf = (d: string) => { const x = parseYmd(d); return new Date(x.getFullYear(), x.getMonth(), 1); };
  const [view, setView] = useState(() => firstOf(day));
  useEffect(() => { if (open) setView(firstOf(day)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthStart = ymd(view);
  const monthEnd = ymd(new Date(view.getFullYear(), view.getMonth() + 1, 0));
  const gridStart = startOfWeek(monthStart, settings.weekStartsOn);
  const cells: string[] = [];
  for (let d = gridStart; d <= monthEnd || cells.length % 7; d = addDays(d, 1)) cells.push(d);
  const today = todayStr();
  return (
    <PickerTitle label={label} open={open} onOpenChange={setOpen} testId={testId}>
      <StepHeader label={fmtDate(monthStart, { month: "long", year: "numeric" })} unit="month"
        onPrev={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
        onNext={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} />
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {Array.from({ length: 7 }, (_, n) => (
          <div key={n} className="pb-1 text-xs text-muted-foreground">{DAY_SHORT[(n + settings.weekStartsOn) % 7].slice(0, 2)}</div>
        ))}
        {cells.map((d) => {
          const inMonth = d >= monthStart && d <= monthEnd;
          const selected = d === day;
          return (
            <button key={d} type="button" onClick={() => { onPick(d); setOpen(false); }}
              className={cn("relative grid h-9 place-items-center rounded-md text-sm tnum transition-colors",
                selected ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-muted",
                !inMonth && !selected && "text-muted-foreground/50", d === today && !selected && "text-primary font-semibold")}
              aria-pressed={selected} aria-label={`${fmtDate(d, { weekday: "long", month: "long", day: "numeric" })}${marked?.has(d) ? ", has entries" : ""}`}
              data-testid={`button-pick-day-${d}`}>
              {parseYmd(d).getDate()}
              {marked?.has(d) && (
                <span className={cn("absolute bottom-1 h-1 w-1 rounded-full", selected ? "bg-primary-foreground" : "bg-primary")} aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </PickerTitle>
  );
}
