import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import type { Item } from "@shared/schema";
import { PageHeader } from "@/components/shell";
import { NavOrderEditor } from "@/components/navOrder";
import { DayPicker } from "@/pages/calendar";
import { AgendaList } from "@/components/agendaList";
import { DayColumn, HourLabels, HOUR_PX } from "@/components/timeline";
import { usePlanner, useNow, useToday, Ring, StreakBadge } from "@/components/planner";
import { HabitCheck, TaskCheck } from "@/components/checks";
import { Morph, SlidePill, useGlide, useShown, useSlidePill } from "@/components/motion";
import { blankItem, useItemMutations, useItems, useSaveSettings, useSettings } from "@/lib/data";
import {
  KIND_META,
  addDays,
  blocksForDay,
  colorOf,
  completionsOf,
  fmtDate,
  fmtDur,
  fmtTime,
  isDeadlineTask,
  isTimed,
  kindOf,
  parseQuick,
  recLabel,
  recOf,
  routineSchedules,
  toMin,
  todayStr,
  taskAvailableFrom,
} from "@/lib/cal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SortableList } from "@/components/sortable";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { accentOf, taskColor } from "@/components/taskTags";
import { TODAY_PANELS, panelShown, panelToggle, allDayFor, dayBreakdown, habitRowsFor, taskRowsFor, todayPanelOrder, type TodayPanel } from "@/lib/today";
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Play, CornerDownLeft, SlidersHorizontal, GripVertical } from "lucide-react";

export default function Today() {
  const [, params] = useRoute("/day/:date");
  const [, nav] = useLocation();
  // The page follows the date (at midnight too); only the Right now card keeps the time.
  const today = useToday();
  const day = params?.date ?? today;
  const isToday = day === today;
  const { data: items, isLoading } = useItems();
  const { settings } = useSettings();
  const { openDetails, startFocus } = usePlanner();
  const list = items ?? [];

  const shows = (panel: TodayPanel) => panelShown(settings, panel);
  const saveSettings = useSaveSettings();
  const view = settings.todayView ?? "timeline";
  const agenda = view === "agenda";
  const pickView = (v: "timeline" | "agenda") => v !== view && saveSettings.mutate({ todayView: v });
  const wholeDay = !!settings.timelineWholeDay;
  const toggleWholeDay = () => saveSettings.mutate({ timelineWholeDay: !wholeDay });
  const panelOrder = todayPanelOrder(settings.todayPanelOrder);
  // On phones the two columns below dissolve (display: contents) into one list in this order;
  // on wide screens each column keeps the same relative order.
  const at = (panel: TodayPanel) => ({ order: panelOrder.indexOf(panel) });
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (!isToday) {
      el.scrollTop = 0; // other days start at 12am
      return;
    }
    // Today opens with the timeline starting 1.5 hours before now (it doesn't follow the clock after
    // that). 8px is the column's top padding.
    const now = new Date();
    el.scrollTop = Math.max(0, 8 + ((now.getHours() * 60 + now.getMinutes() - 90) / 60) * HOUR_PX);
  }, [day, isLoading, shows("schedule"), agenda, wholeDay]); // eslint-disable-line

  const breakdown = useMemo(() => dayBreakdown(list, settings, day), [list, settings.routines, day]);
  const agendaItems = useMemo(() => list.filter((i) => kindOf(i) !== "habit" && kindOf(i) !== "sleep"), [list]);

  const allDay = allDayFor(list, day);


  return (
    <>
      <PageHeader
        title={<DayPicker day={day} label={`${isToday ? "Today · " : ""}${fmtDate(day, { weekday: "long", month: "long", day: "numeric" })}`}
          onPick={(d) => nav(d === todayStr() ? "/" : `/day/${d}`)} testId="button-pick-today-day" />}
      >
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => nav(`/day/${addDays(day, -1)}`)} aria-label="Previous day" data-swipe="prev" data-testid="button-prev-day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav("/")} disabled={isToday} data-testid="button-today">
            Today
          </Button>
          <Button size="icon" variant="ghost" onClick={() => nav(`/day/${addDays(day, 1)}`)} aria-label="Next day" data-swipe="next" data-testid="button-next-day">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </PageHeader>

      {/* The day itself: what slides when the day changes (data-turn-body, see pageTurn). */}
      <div data-turn-body className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 p-4 md:p-6 lg:h-full">
          {/* left: timeline */}
          <section className={cn("contents lg:flex lg:flex-col lg:min-h-0 lg:gap-3", wholeDay && "lg:overflow-y-auto scroll-thin lg:pr-1")} aria-label="Day timeline">
            {isToday && shows("now") && <div style={at("now")}><NowCard items={list} onStart={startFocus} /></div>}
            {shows("day") && <div style={at("day")}><DayBreakdown totals={breakdown.totals} spans={breakdown.spans} /></div>}
            {/* One card for both views: switching keeps the toggle (its highlight slides) and fades the view in. */}
            {shows("schedule") && (
            <div className={cn("flex flex-col card-md overflow-hidden", !agenda && (wholeDay ? "shrink-0" : "flex-1 min-h-[420px]"))} style={at("schedule")} data-testid="card-day">
              <DayViewToggle view={view} onPick={pickView} wholeDay={wholeDay} onWholeDay={agenda ? undefined : toggleWholeDay} />
              {agenda ? (
                <div key="agenda" className="px-4 pb-4 swap-in">
                  <AgendaList list={agendaItems} from={day} days={1} compact dates={false} emptyToday="Nothing planned" always />
                </div>
              ) : (
              <div key="timeline" className={cn("flex flex-col swap-in", !wholeDay && "flex-1")}>
              {/* All-day items and ones for anytime that day, inside the card above the timeline. */}
              {allDay.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-b px-2 pb-2" aria-label="All-day">
                  {allDay.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => openDetails(i, day)}
                      className="min-w-0 max-w-full truncate rounded-md px-2 py-1 text-xs font-medium hover-elevate"
                      style={{ background: `color-mix(in srgb, ${colorOf(i)} 16%, transparent)`, borderLeft: `3px solid ${accentOf(i, settings)}` }}
                      data-testid={`chip-allday-${i.id}`}
                    >
                      {i.title}
                    </button>
                  ))}
                </div>
              )}
              {/* Scrolls inside the card, or (opened with the chevron) is as tall as the day. */}
              <div className={cn("relative", !wholeDay && "flex-1")}>
              {isLoading ? (
                <div className="p-4 grid gap-3">
                  {[0, 1, 2, 3].map((k) => (
                    <Skeleton key={k} className="h-14" />
                  ))}
                </div>
              ) : (
                <div ref={scroller} className={cn(!wholeDay && "absolute inset-0 overflow-y-auto scroll-thin")}>
                  <div className="flex pt-2 pb-4 pr-2">
                    <HourLabels />
                    <DayColumn
                      day={day}
                      items={list}
                      wakeMin={toMin(settings.wakeTime)}
                      bedMin={toMin(settings.bedTime)}
                    />
                  </div>
                </div>
              )}
              </div>
              </div>
              )}
            </div>)}
          </section>

          {/* right rail */}
          <aside className="contents lg:grid lg:grid-cols-1 lg:content-start lg:gap-4 lg:overflow-y-auto scroll-thin lg:pr-1 lg:pb-4" aria-label="Day details">
            {shows("tasks") && <div style={at("tasks")}><TasksCard items={list} day={day} /></div>}
            {shows("habits") && <div style={at("habits")}><HabitsCard items={list} day={day} /></div>}
            {TODAY_PANELS.every((p) => !shows(p.id)) && (
              <p className="text-sm text-muted-foreground text-center" style={{ order: 98 }}>All cards are hidden</p>
            )}
            <div className="pb-4 lg:pb-0" style={{ order: 99 }}><CustomizeToday order={panelOrder} /></div>
          </aside>
        </div>
      </div>
    </>
  );
}


/** "Customize": which Today cards show and in what order, and the order of the pages in the bottom bar. */
function CustomizeToday({ order }: { order: TodayPanel[] }) {
  const [open, setOpen] = useState(false);
  const save = useSaveSettings();
  const { settings } = useSettings();
  const toggle = (panel: TodayPanel, shown: boolean) => save.mutate(panelToggle(settings, panel, shown));
  const isDefault = !settings.hiddenTodayPanels?.length && !settings.shownTodayPanels?.length &&
    !settings.todayPanelOrder?.length && !settings.navOrder?.length;
  return (
    <>
      <div className="flex justify-center">
        <Button variant="ghost" size="sm" className="h-8 rounded-full px-4 text-xs text-muted-foreground" onClick={() => setOpen(true)} data-testid="button-customize-today">
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" /> Customize
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto" data-testid="dialog-customize-today">
          <DialogHeader className="text-left">
            <DialogTitle>Customize</DialogTitle>
            <DialogDescription className="sr-only">Choose which cards show on your Today page and the order of the pages. Hold an item and drag to reorder.</DialogDescription>
          </DialogHeader>
          <section className="grid gap-1" aria-label="Cards">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cards</h3>
            <SortableList
              items={order}
              onReorder={(next) => save.mutate({ todayPanelOrder: next })}
              className="grid gap-1"
              render={(id) => {
                const p = TODAY_PANELS.find((panel) => panel.id === id)!;
                return (
                  <div className="flex items-center gap-3 py-2 pr-1" data-testid={`row-today-${p.id}`}>
                    <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 text-sm font-medium">{p.label}</span>
                    <Switch checked={panelShown(settings, p.id)} onCheckedChange={(v) => toggle(p.id, v)} aria-label={`Show ${p.label}`} data-testid={`switch-today-${p.id}`} />
                  </div>
                );
              }}
            />
          </section>
          {/* Drawn like the bar itself; hold a page and drag it along. The app still opens on Today, wherever it sits. */}
          <section className="grid gap-2" aria-label="Page order">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Page order</h3>
            <NavOrderEditor order={settings.navOrder} onReorder={(next) => save.mutate({ navOrder: next })} />
          </section>
          {/* Every card back on, and the cards and bottom bar back in their first order. */}
          <div className="flex justify-center">
            <Button variant="outline" size="sm" className="h-8 rounded-full px-4 text-xs" disabled={isDefault}
              onClick={() => save.mutate({ hiddenTodayPanels: [], shownTodayPanels: [], todayPanelOrder: [], navOrder: [] })}
              data-testid="button-customize-reset">
              Reset to defaults
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DayBreakdown({ totals, spans }: { totals: number[]; spans: { category: number; length: number }[] }) {
  // The bar grows in from the left when the card shows, and eases to a new day's (or a change's) shape;
  // the totals count over to theirs.
  const grown = useShown();
  const categories = [
    { label: "Free time", color: "hsl(var(--muted))", dot: "hsl(var(--muted-foreground))" },
    { label: "Routines", color: "hsl(var(--k-sleep) / .72)", dot: "hsl(var(--k-sleep))" },
    { label: "Planned", color: "hsl(var(--primary))", dot: "hsl(var(--primary))" },
  ];
  return (
    <div className="card-md p-4 grid gap-3" data-testid="card-day-breakdown">
      <h2 className="text-sm font-semibold">Your day</h2>
      <div className="flex h-5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Routines ${fmtDur(totals[1])}, planned ${fmtDur(totals[2])}, free ${fmtDur(totals[0])}`}>
        {spans.map((span, index) => <div key={index} className="shrink-0 transition-[width,background-color] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: grown ? `${span.length / 1440 * 100}%` : 0, background: categories[span.category].color }} />)}
      </div>
      <div className="grid grid-cols-3 gap-1 text-center sm:text-left">
        {[1, 2, 0].map((category) => <div key={category} className="min-w-0" data-testid={`stat-${categories[category].label.toLowerCase().replace(" ", "-")}`}>
          <div className="flex items-center justify-center sm:justify-start gap-1 text-[12px] text-muted-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: categories[category].dot }} />{categories[category].label}
          </div>
          <GlideDur minutes={totals[category]} />
        </div>)}
      </div>
    </div>
  );
}

function GlideDur({ minutes }: { minutes: number }) {
  return <div className="font-semibold text-sm tnum">{fmtDur(Math.round(useGlide(minutes, 0, 700, true)))}</div>;
}

export function QuickAdd({ day = todayStr(), appbar = false, onDone }: { day?: string; appbar?: boolean; onDone?: () => void }) {
  const [text, setText] = useState("");
  const { create } = useItemMutations();
  const { settings } = useSettings();
  const p = text.trim() ? parseQuick(text, day) : null;
  const submit = async () => {
    if (!p) return;
    const item = blankItem({
      title: p.title,
      kind: p.kind,
      date: p.date,
      startTime: p.startTime,
      endTime: p.endTime,
      recurrence: JSON.stringify(p.recurrence),
      reminder: p.startTime ? settings.defaultReminder : null,
      availableFrom: p.kind === "task" ? taskAvailableFrom(p.date, p.startTime, p.recurrence.freq) : null,
    });
    await create.mutateAsync(item);
    setText("");
    onDone?.();
  };
  return (
    <div className={cn("relative bg-card text-card-foreground", appbar ? "rounded-full border" : "card-md !rounded-full")}>
      <div className={cn("flex items-center", appbar ? "gap-1.5 px-3.5" : "gap-2 px-4")}>
        <Plus className="h-4 w-4 text-primary shrink-0" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={settings.plain ? "#event Art class every sat 1pm" : "#event Catnap every sat 1pm"}
          className={cn("border-0 bg-transparent shadow-none placeholder:italic placeholder:text-[14px] focus-visible:ring-0 focus-visible:ring-offset-0 px-0", appbar ? "h-10 md:h-11" : "h-11")}
          aria-label="Quick add"
          data-testid="input-quick-add"
        />
        {p && (
          <Button size="sm" onClick={submit} disabled={create.isPending} data-testid="button-quick-add">
            <CornerDownLeft className="h-3.5 w-3.5 mr-1" />
            {p.kind === "sleep" ? "Set sleep" : "Add"}
          </Button>
        )}
      </div>
      {p && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-1.5 border-t px-3 py-2 text-xs text-muted-foreground",
          )}
          data-testid="text-quick-preview"
        >
          <span
            className="rounded px-1.5 py-0.5 font-medium text-foreground"
            style={{ background: `hsl(var(${KIND_META[p.kind].cssVar}) / .16)` }}
          >
            {KIND_META[p.kind].label}
          </span>
          <span className="text-foreground font-medium">{p.title}</span>
          <span>· {summary(p)}</span>
          <span className="ml-auto hidden sm:inline">Use #task #habit #meeting #focus to set the type</span>
        </div>
      )}
    </div>
  );
}
function summary(p: ReturnType<typeof parseQuick>) {
  const parts = [p.date === todayStr() ? "Today" : fmtDate(p.date, { weekday: "short", month: "short", day: "numeric" })];
  if (p.startTime) parts.push(`${fmtTime(p.startTime, true)}–${fmtTime(p.endTime, true)}`);
  else parts.push("anytime");
  const r = p.recurrence;
  if (r.freq === "daily") parts.push("every day");
  if (r.freq === "weekdays") parts.push("weekdays");
  if (r.freq === "weekly") parts.push("weekly on " + (r.days || []).map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", "));
  return parts.join(" · ");
}

/** A Today card's header: tapping it opens the card's page; its own buttons keep their taps. */
function CardHeaderLink({ to, title, testId, children }: { to: string; title: string; testId: string; children: React.ReactNode }) {
  const [, nav] = useLocation();
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={(e) => !(e.target as HTMLElement).closest("button") && nav(to)}
      onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && nav(to)}
      className="flex cursor-pointer items-center justify-between rounded-t-[20px] px-4 pt-3 pb-2 hover:bg-muted/40"
      aria-label={`Open ${title}`}
      data-testid={testId}
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function NowCard({ items, onStart }: { items: Item[]; onStart: ReturnType<typeof usePlanner>["startFocus"] }) {
  const { focus, openDetails } = usePlanner();
  const now = useNow(30000);
  const nm = now.getHours() * 60 + now.getMinutes();
  const today = todayStr();
  const { settings } = useSettings();
  // The day's work, done once per change rather than on every clock tick.
  const { blocks, tasksLeft, routines } = useMemo(() => ({
    // Tasks that are already checked off don't need doing now.
    blocks: blocksForDay(items, today).filter((b) => !(b.done && kindOf(b.item) === "task")),
    // With nothing on, it nudges toward a task if any are left today.
    tasksLeft: taskRowsFor(items, today, true).some((r) => !r.done),
    routines: blocksForDay(routineSchedules(settings), today),
  }), [items, today, settings]);
  // A task is due at its time rather than taking up the half hour it's drawn as: it can be next, not current.
  const current = blocks.find((b) => nm >= b.start && nm < b.end && kindOf(b.item) !== "task");
  const next = blocks.find((b) => b.start > nm && b.continues !== "before");
  // With nothing else on, a routine from Settings is named (no ring, and it's never "next").
  const routine = routines.find((b) => nm >= b.start && nm < b.end);
  return (
    // As things start and end, what's shown crossfades and the card eases to its new size.
    <div className="card-md wellness-now p-4 md:p-5 flex flex-col" data-testid="card-now">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Right now</h2>
        <span className="rounded-full bg-white/70 dark:bg-white/10 px-2.5 py-1 text-xs text-muted-foreground tnum">{fmtTime(nm)}</span>
      </div>
      <Morph className="mt-3" k={current ? `now-${current.key}` : routine ? `routine-${routine.key}` : tasksLeft ? "free-tasks" : "free"}>
      {current ? (
        <div className="flex items-center gap-3">
          {/* Tapping the item opens its details. */}
          <button type="button" onClick={() => openDetails(current.item, current.occDate)} className="flex min-w-0 flex-1 items-center gap-3 text-left" data-testid="button-now-current">
          <div className="relative shrink-0">
            <Ring pct={(nm - current.fullStart) / (current.fullEnd - current.fullStart)} color={colorOf(current.item)} size={48} />
            <span className="absolute inset-0 grid place-items-center">
              {(() => {
                const I = KIND_META[kindOf(current.item)].icon;
                return <I className="h-4 w-4" style={{ color: colorOf(current.item) }} />;
              })()}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-base fade-truncate" data-testid="text-now-title">
              {current.item.title}
            </div>
            <div className="text-xs text-muted-foreground tnum">
              {fmtDur(current.fullEnd - nm)} left · ends {fmtTime(((current.fullEnd % 1440) + 1440) % 1440, true)}
              {current.fullEnd > 1440 ? ` ${fmtDate(addDays(today, Math.floor(current.fullEnd / 1440)), { month: "short", day: "numeric" })}` : ""}
            </div>
          </div>
          </button>
          {kindOf(current.item) !== "sleep" && !focus && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStart({ title: current.item.title, itemId: current.item.id, minutes: Math.max(5, Math.round(current.fullEnd - nm)) })}
              data-testid="button-now-focus"
            >
              <Play className="h-3.5 w-3.5 mr-1" />
              Focus
            </Button>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground" data-testid="text-now-empty">
          {routine ? `Looks like you've got a routine now — ${routine.item.title}`
            : tasksLeft ? "Nothing's happening right now... Maybe there's time for a task!" : "Looks like you've got some free time!"}
        </div>
      )}
      </Morph>
      <Morph k={next ? `next-${next.key}` : "none"}>
      {next && (
        <button type="button" onClick={() => openDetails(next.item, next.occDate)}
          className="mt-3 flex w-full items-center gap-2 border-t border-orange-200/70 dark:border-white/10 pt-3 text-left text-sm" data-testid="button-now-next">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colorOf(next.item) }} />
          <span className="text-muted-foreground">Next</span>
          <span className="min-w-0 flex-1 font-medium fade-truncate">{next.item.title}</span>
          <span className="text-xs text-muted-foreground tnum shrink-0">
            {fmtTime(next.start, true)} · in {fmtDur(next.start - nm)}
          </span>
        </button>
      )}
      </Morph>
    </div>
  );
}

function TasksCard({ items, day }: { items: Item[]; day: string }) {
  const { toggle } = useItemMutations();
  const { openEditor, openDetails, startFocus } = usePlanner();
  const { settings } = useSettings();
  const isToday = day === todayStr();
  const rows = taskRowsFor(items, day, isToday);
  const left = rows.filter((r) => !r.done).length;


  return (
    <div className="card-md" data-testid="card-tasks">
      <CardHeaderLink to="/tasks" title="Tasks" testId="link-tasks-page">
          <span className="text-xs text-muted-foreground">{rows.length ? `${left} left` : ""}</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditor({ date: day, kind: "task" })} aria-label="Add task" data-testid="button-add-task">
            <Plus className="h-4 w-4" />
          </Button>
      </CardHeaderLink>
      {rows.length === 0 ? (
        <div className="px-4 pb-4 text-sm text-muted-foreground">You don't have any tasks today</div>
      ) : (
        <ul className="pb-2">
          {rows.map(({ i, occ, overdue, done }) => {
            return (
              <li key={`${i.id}:${occ}`} className="group flex items-center gap-2.5 px-4 py-1.5 hover:bg-muted/50" data-testid={`row-task-${i.id}`}>
                <TaskCheck done={done} color={taskColor(i, settings)} className="h-[18px] w-[18px] rounded border-[1.5px]" checkClassName="h-3 w-3"
                  onToggle={() => toggle.mutate({ id: i.id, date: occ })}
                  label={done ? `Mark ${i.title} not done` : `Mark ${i.title} done`} testId={`button-toggle-task-${i.id}`} />
                <button onClick={() => openDetails(i, occ)} className="min-w-0 flex-1 text-left">
                  <div className={cn("text-sm fade-truncate transition-colors", done && "text-muted-foreground")}><span className="strike" data-on={done}>{i.title}</span></div>
                  <div className="text-xs text-muted-foreground flex gap-1.5">
                    {overdue && <span className="text-destructive">Overdue</span>}
                    {isDeadlineTask(i) && <span>Due {fmtDate(occ, { month: "short", day: "numeric" })}</span>}
                    {i.priority === "high" && <span className="text-[hsl(var(--k-task))] font-medium">High</span>}
                    {isTimed(i) && <span className="tnum">{fmtTime(i.startTime, true)}</span>}
                    {recOf(i).freq !== "none" && <span>{recLabel(i)}</span>}
                  </div>
                </button>
                {!done && (
                  <div className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => startFocus({ title: i.title, itemId: i.id, minutes: settings.focusMinutes })}
                      aria-label="Start timer"
                      data-testid={`button-focus-task-${i.id}`}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Switches the day card between the timeline and the agenda list, like the calendar's view switch. */
function DayViewToggle({ view, onPick, wholeDay, onWholeDay }: {
  view: "timeline" | "agenda"; onPick: (v: "timeline" | "agenda") => void;
  /** The timeline's whole-day chevron: all 24 hours at once instead of scrolling inside the card. */
  wholeDay?: boolean; onWholeDay?: () => void;
}) {
  const [tabs, pill] = useSlidePill<HTMLDivElement>(view);
  return (
    <div className="flex items-center justify-between gap-2 px-2 pt-2 pb-2">
      <div ref={tabs} className="relative inline-flex rounded-full border bg-card p-0.5" role="tablist" aria-label="Show the day as">
        <SlidePill box={pill} className="rounded-full bg-primary" />
        {(["timeline", "agenda"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => onPick(v)}
            className={cn("relative h-7 px-3 rounded-full text-xs font-medium transition-colors duration-300",
              view === v ? "text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            data-testid={`tab-day-${v}`}>
            {v === "timeline" ? "Timeline" : "Agenda"}
          </button>
        ))}
      </div>
      {/* A chevron opens the timeline out to the whole day, and folds it back. */}
      {onWholeDay && (
        <button type="button" onClick={onWholeDay} aria-expanded={!!wholeDay} aria-label={wholeDay ? "Show less of the day" : "Show the whole day"}
          className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          data-testid="button-timeline-whole-day">
          <ChevronDown className={cn("h-5 w-5 transition-transform", wholeDay && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

function HabitsCard({ items, day }: { items: Item[]; day: string }) {
  const { cycle } = useItemMutations();
  const { settings } = useSettings();
  const { openEditor, openDetails } = usePlanner();
  const habitRows = habitRowsFor(items, day, settings);
  const habits = habitRows.map((r) => r.h);
  const done = habits.filter((h) => completionsOf(h).has(day)).length;
  return (
    <div className="card-md" data-testid="card-habits">
      <CardHeaderLink to="/habits" title="Habits" testId="link-habits-page">
          {habits.length > 0 && (
            <span className="text-xs text-muted-foreground tnum">
              {done}/{habits.length}
            </span>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditor({ date: day, kind: "habit", recurrence: '{"freq":"daily"}' })} aria-label="Add habit" data-testid="button-add-habit">
            <Plus className="h-4 w-4" />
          </Button>
      </CardHeaderLink>
      {habits.length === 0 ? (
        <div className="px-4 pb-4 text-sm text-muted-foreground">
          {items.some((i) => kindOf(i) === "habit") ? "No habits today" : "You haven't made any habits yet"}
        </div>
      ) : (
        <ul className="pb-2">
          {habitRows.map(({ h, mark: mk, streak }) => {
            const isDone = mk === 2;
            return (
              <li key={h.id} className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-muted/50" data-testid={`row-habit-${h.id}`}>
                <HabitCheck mark={mk} color="hsl(var(--k-habit))" onCycle={() => cycle.mutate({ id: h.id, date: day })}
                  className="h-[18px] w-[18px]" buttonClassName="border-[1.5px]" checkClassName="h-3 w-3"
                  label={`${h.title}: ${["not done", "half done", "done"][mk]}`} testId={`button-toggle-habit-${h.id}`} />
                <button onClick={() => openDetails(h, day)} className="min-w-0 flex-1 text-left">
                  <div className={cn("text-sm fade-truncate", isDone && "text-muted-foreground")}>{h.title}</div>
                  <div className="text-xs text-muted-foreground">{isTimed(h) ? fmtTime(h.startTime, true) + " · " : ""}{recLabel(h)}</div>
                </button>
                <StreakBadge streak={streak} className="text-xs" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
