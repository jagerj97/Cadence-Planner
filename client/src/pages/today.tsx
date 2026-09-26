import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import type { Item } from "@shared/schema";
import { PageHeader } from "@/components/shell";
import { DayColumn, HourLabels, HOUR_PX } from "@/components/timeline";
import { usePlanner, useNow, Ring } from "@/components/planner";
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
  toMin,
  todayStr,
  untimedForDay,
  taskAvailableFrom,
} from "@/lib/cal";
import { Button } from "@/components/ui/button";
import { fillOf } from "@/pages/other";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SortableList } from "@/components/sortable";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { TODAY_PANELS, dayBreakdown, habitRowsFor, taskRowsFor, todayPanelOrder, type TodayPanel } from "@/lib/today";
import { ChevronLeft, ChevronRight, Plus, Check, Flame, Play, CornerDownLeft, SlidersHorizontal, GripVertical } from "lucide-react";

export default function Today() {
  const [, params] = useRoute("/day/:date");
  const [, nav] = useLocation();
  const day = params?.date ?? todayStr();
  const isToday = day === todayStr();
  const { data: items, isLoading } = useItems();
  const { settings } = useSettings();
  const { openDetails, startFocus } = usePlanner();
  const now = useNow(30000);
  const list = items ?? [];

  const hidden = new Set(settings.hiddenTodayPanels ?? []);
  const shows = (panel: TodayPanel) => !hidden.has(panel);
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
    // Start today at the current hour when the timeline opens (it doesn't follow the clock after that).
    // 8px is the column's top padding; the extra 16px keeps that hour's label readable above it.
    const hourY = 8 + new Date().getHours() * HOUR_PX;
    el.scrollTop = Math.max(0, hourY - 16);
  }, [day, isLoading, shows("schedule")]); // eslint-disable-line

  const breakdown = useMemo(() => dayBreakdown(list, settings, day), [list, settings.routines, day]);

  const allDay = untimedForDay(list, day).filter((i) => i.allDay || (kindOf(i) !== "task" && kindOf(i) !== "habit"));


  return (
    <>
      <PageHeader
        title={`${isToday ? "Today · " : ""}${fmtDate(day, { weekday: "long", month: "long", day: "numeric" })}`}
      >
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => nav(`/day/${addDays(day, -1)}`)} aria-label="Previous day" data-testid="button-prev-day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav("/")} disabled={isToday} data-testid="button-today">
            Today
          </Button>
          <Button size="icon" variant="ghost" onClick={() => nav(`/day/${addDays(day, 1)}`)} aria-label="Next day" data-testid="button-next-day">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 p-4 md:p-6 lg:h-full">
          {/* left: timeline */}
          <section className="contents lg:flex lg:flex-col lg:min-h-0 lg:gap-3" aria-label="Day timeline">
            {isToday && shows("now") && <div style={at("now")}><NowCard items={list} now={now} onStart={startFocus} /></div>}
            {shows("day") && <div style={at("day")}><DayBreakdown totals={breakdown.totals} spans={breakdown.spans} /></div>}
            {shows("schedule") && allDay.length > 0 && (
              <div className="flex flex-wrap gap-1.5" style={at("schedule")} aria-label="All-day">
                {allDay.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => openDetails(i, day)}
                    className="rounded-md px-2 py-1 text-xs font-medium hover-elevate"
                    style={{ background: `color-mix(in srgb, ${colorOf(i)} 16%, transparent)`, borderLeft: `3px solid ${colorOf(i)}` }}
                    data-testid={`chip-allday-${i.id}`}
                  >
                    {i.title}
                  </button>
                ))}
              </div>
            )}
            {shows("schedule") && <div className="relative flex-1 min-h-[420px] card-md overflow-hidden" style={at("schedule")}>
              {isLoading ? (
                <div className="p-4 grid gap-3">
                  {[0, 1, 2, 3].map((k) => (
                    <Skeleton key={k} className="h-14" />
                  ))}
                </div>
              ) : (
                <div ref={scroller} className="absolute inset-0 overflow-y-auto scroll-thin">
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
            </div>}
            {shows("schedule") && <p className="text-xs text-muted-foreground hidden md:block" style={at("schedule")}>
              Click an empty slot to add · hold a block briefly, then drag to move or resize
            </p>}
          </section>

          {/* right rail */}
          <aside className="contents lg:grid lg:grid-cols-1 lg:content-start lg:gap-4 lg:overflow-y-auto scroll-thin lg:pr-1 lg:pb-4" aria-label="Day details">
            {shows("tasks") && <div style={at("tasks")}><TasksCard items={list} day={day} /></div>}
            {shows("habits") && <div style={at("habits")}><HabitsCard items={list} day={day} /></div>}
            {TODAY_PANELS.every((p) => !shows(p.id)) && (
              <p className="text-sm text-muted-foreground text-center" style={{ order: 98 }}>All cards are hidden.</p>
            )}
            <div className="pb-4 lg:pb-0" style={{ order: 99 }}><CustomizeToday hidden={hidden} order={panelOrder} /></div>
          </aside>
        </div>
      </div>
    </>
  );
}


function CustomizeToday({ hidden, order }: { hidden: Set<string>; order: TodayPanel[] }) {
  const [open, setOpen] = useState(false);
  const save = useSaveSettings();

  const toggle = (panel: TodayPanel, shown: boolean) => {
    const next = new Set(hidden);
    if (shown) next.delete(panel); else next.add(panel);
    save.mutate({ hiddenTodayPanels: TODAY_PANELS.map((p) => p.id).filter((id) => next.has(id)) });
  };
  return (
    <>
      <div className="flex justify-center">
        <Button variant="ghost" size="sm" className="h-8 rounded-full px-4 text-xs text-muted-foreground" onClick={() => setOpen(true)} data-testid="button-customize-today">
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" /> Customize cards
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" data-testid="dialog-customize-today">
          <DialogHeader className="text-left">
            <DialogTitle>Customize cards</DialogTitle>
            <DialogDescription>Choose which cards show on your Today page. Hold a card and drag to reorder.</DialogDescription>
          </DialogHeader>
          <SortableList
            items={order}
            onReorder={(next) => save.mutate({ todayPanelOrder: next })}
            className="grid gap-1"
            render={(id) => {
              const p = TODAY_PANELS.find((panel) => panel.id === id)!;
              return (
                <div className="flex items-center gap-3 py-2 pr-1" data-testid={`row-today-${p.id}`}>
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span className="block text-xs text-muted-foreground">{p.hint}</span>
                  </span>
                  <Switch checked={!hidden.has(p.id)} onCheckedChange={(v) => toggle(p.id, v)} aria-label={`Show ${p.label}`} data-testid={`switch-today-${p.id}`} />
                </div>
              );
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function DayBreakdown({ totals, spans }: { totals: number[]; spans: { category: number; length: number }[] }) {
  const categories = [
    { label: "Free time", color: "hsl(var(--muted))", dot: "hsl(var(--muted-foreground))" },
    { label: "Routines", color: "hsl(var(--k-sleep) / .72)", dot: "hsl(var(--k-sleep))" },
    { label: "Planned", color: "hsl(var(--primary))", dot: "hsl(var(--primary))" },
  ];
  return (
    <div className="card-md p-4 grid gap-3" data-testid="card-day-breakdown">
      <h2 className="text-sm font-semibold">Your day</h2>
      <div className="flex h-5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Routines ${fmtDur(totals[1])}, planned ${fmtDur(totals[2])}, free ${fmtDur(totals[0])}`}>
        {spans.map((span, index) => <div key={index} style={{ width: `${span.length / 1440 * 100}%`, background: categories[span.category].color }} />)}
      </div>
      <div className="grid grid-cols-3 gap-1 text-center sm:text-left">
        {[1, 2, 0].map((category) => <div key={category} className="min-w-0" data-testid={`stat-${categories[category].label.toLowerCase().replace(" ", "-")}`}>
          <div className="flex items-center justify-center sm:justify-start gap-1 text-[12px] text-muted-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: categories[category].dot }} />{categories[category].label}
          </div>
          <div className="font-semibold text-sm tnum">{fmtDur(totals[category])}</div>
        </div>)}
      </div>
    </div>
  );
}

export function QuickAdd({ day = todayStr(), appbar = false, onDone }: { day?: string; appbar?: boolean; onDone?: () => void }) {
  const [text, setText] = useState("");
  const [, nav] = useLocation();
  const { create } = useItemMutations();
  const { settings } = useSettings();
  const { toast } = useToast();
  const p = text.trim() ? parseQuick(text, day) : null;
  const submit = async () => {
    if (!p) return;
    if (p.kind === "sleep") {
      nav("/settings");
      toast({ title: "Sleep is a schedule", description: "Set bedtime and wake time in Settings." });
      setText("");
      onDone?.();
      return;
    }
    const item = blankItem({
      title: p.title,
      kind: p.kind,
      date: p.date,
      startTime: p.startTime,
      endTime: p.endTime,
      recurrence: JSON.stringify(p.recurrence),
      reminder: p.startTime ? settings.defaultReminder : null,
      availableFrom: p.kind === "task" ? taskAvailableFrom(p.date, p.startTime, JSON.stringify(p.recurrence)) : null,
    });
    await create.mutateAsync(item);
    toast({ title: `${KIND_META[p.kind].label} added`, description: summary(p) });
    setText("");
    onDone?.();
  };
  return (
    <div className={cn("relative rounded bg-card text-card-foreground", appbar ? "border" : "card-md")}>
      <div className="flex items-center gap-2 px-3">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="#event Art Class every wed 6pm"
          className={cn("border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-0", appbar ? "h-10 md:h-11" : "h-11")}
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

function NowCard({ items, now, onStart }: { items: Item[]; now: Date; onStart: ReturnType<typeof usePlanner>["startFocus"] }) {
  const { focus } = usePlanner();
  const nm = now.getHours() * 60 + now.getMinutes();
  const today = todayStr();
  const blocks = blocksForDay(items, today);
  const current = blocks.find((b) => nm >= b.start && nm < b.end);
  const next = blocks.find((b) => b.start > nm && b.continues !== "before");
  return (
    <div className="card-md wellness-now p-4 md:p-5 grid gap-3" data-testid="card-now">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Right now</h2>
        <span className="rounded-full bg-white/70 dark:bg-white/10 px-2.5 py-1 text-xs text-muted-foreground tnum">{fmtTime(nm)}</span>
      </div>
      {current ? (
        <div className="flex items-center gap-3">
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
        <div className="text-sm text-muted-foreground">Nothing scheduled right now — a good moment for a task below.</div>
      )}
      {next && (
        <div className="flex items-center gap-2 border-t border-orange-200/70 dark:border-white/10 pt-3 text-sm">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colorOf(next.item) }} />
          <span className="text-muted-foreground">Next</span>
          <span className="font-medium fade-truncate flex-1">{next.item.title}</span>
          <span className="text-xs text-muted-foreground tnum shrink-0">
            {fmtTime(next.start, true)} · in {fmtDur(next.start - nm)}
          </span>
        </div>
      )}
    </div>
  );
}

function TasksCard({ items, day }: { items: Item[]; day: string }) {
  const [, nav] = useLocation();
  const { toggle } = useItemMutations();
  const { openEditor, openDetails, startFocus } = usePlanner();
  const { settings } = useSettings();
  const isToday = day === todayStr();
  const rows = taskRowsFor(items, day, isToday);
  const left = rows.filter((r) => !r.done).length;


  return (
    <div className="card-md" data-testid="card-tasks">
      <div
        role="link"
        tabIndex={0}
        onClick={() => nav("/tasks")}
        onKeyDown={(e) => e.key === "Enter" && nav("/tasks")}
        className="flex cursor-pointer items-center justify-between rounded-t-[20px] px-4 pt-3 pb-2 hover:bg-muted/40"
        aria-label="Open Tasks"
        data-testid="link-tasks-page"
      >
        <h2 className="text-sm font-semibold">Tasks</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{rows.length ? `${left} left` : ""}</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEditor({ date: day, kind: "task" }); }} aria-label="Add task" data-testid="button-add-task">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 pb-4 text-sm text-muted-foreground">No tasks. Type one in the bar above — it lands here if it has no time.</div>
      ) : (
        <ul className="pb-2">
          {rows.map(({ i, occ, overdue, done }) => {
            return (
              <li key={`${i.id}:${occ}`} className="group flex items-center gap-2.5 px-4 py-1.5 hover:bg-muted/50" data-testid={`row-task-${i.id}`}>
                <button
                  onClick={() => toggle.mutate({ id: i.id, date: occ })}
                  className="h-[18px] w-[18px] shrink-0 rounded grid place-items-center border-[1.5px]"
                  style={{ borderColor: "hsl(var(--k-task))", background: done ? "hsl(var(--k-task))" : "transparent" }}
                  aria-label={done ? `Mark ${i.title} not done` : `Mark ${i.title} done`}
                  data-testid={`button-toggle-task-${i.id}`}
                >
                  {done && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
                </button>
                <button onClick={() => openDetails(i, occ)} className="min-w-0 flex-1 text-left">
                  <div className={cn("text-sm fade-truncate", done && "line-through text-muted-foreground")}>{i.title}</div>
                  <div className="text-xs text-muted-foreground flex gap-1.5">
                    {overdue && <span className="text-destructive">Overdue</span>}
                    {isDeadlineTask(i) && <span>Due {fmtDate(i.date, { month: "short", day: "numeric" })}</span>}
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

function HabitsCard({ items, day }: { items: Item[]; day: string }) {
  const [, nav] = useLocation();
  const { cycle } = useItemMutations();
  const { settings } = useSettings();
  const { openEditor, openDetails } = usePlanner();
  const habitRows = habitRowsFor(items, day, settings);
  const habits = habitRows.map((r) => r.h);
  const done = habits.filter((h) => completionsOf(h).has(day)).length;
  return (
    <div className="card-md" data-testid="card-habits">
      <div
        role="link"
        tabIndex={0}
        onClick={() => nav("/habits")}
        onKeyDown={(e) => e.key === "Enter" && nav("/habits")}
        className="flex cursor-pointer items-center justify-between rounded-t-[20px] px-4 pt-3 pb-2 hover:bg-muted/40"
        aria-label="Open Habits"
        data-testid="link-habits-page"
      >
        <h2 className="text-sm font-semibold">Habits</h2>
        <div className="flex items-center gap-2">
          {habits.length > 0 && (
            <span className="text-xs text-muted-foreground tnum">
              {done}/{habits.length}
            </span>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEditor({ date: day, kind: "habit", recurrence: '{"freq":"daily"}' }); }} aria-label="Add habit" data-testid="button-add-habit">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {habits.length === 0 ? (
        <div className="px-4 pb-4 text-sm text-muted-foreground">No habits today. Try “Read 20 min every day #habit”.</div>
      ) : (
        <ul className="pb-2">
          {habitRows.map(({ h, mark: mk, streak }) => {
            const isDone = mk === 2;
            return (
              <li key={h.id} className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-muted/50" data-testid={`row-habit-${h.id}`}>
                <button
                  onClick={() => cycle.mutate({ id: h.id, date: day })}
                  className="h-[18px] w-[18px] shrink-0 rounded-full grid place-items-center border-[1.5px]"
                  style={{ borderColor: "hsl(var(--k-habit))", background: fillOf(mk, "hsl(var(--k-habit))", 90) }}
                  aria-label={`${h.title}: ${["not done", "half done", "done"][mk]}`}
                  data-testid={`button-toggle-habit-${h.id}`}
                >
                  {isDone && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
                </button>
                <button onClick={() => openDetails(h, day)} className="min-w-0 flex-1 text-left">
                  <div className={cn("text-sm fade-truncate", isDone && "text-muted-foreground")}>{h.title}</div>
                  <div className="text-xs text-muted-foreground">{isTimed(h) ? fmtTime(h.startTime, true) + " · " : ""}{recLabel(h)}</div>
                </button>
                {streak > 0 && (
                  <span className="flex items-center gap-0.5 text-xs font-medium tnum text-[hsl(var(--k-task))]" title={`${streak}-day streak`}>
                    <Flame className="h-3.5 w-3.5" />
                    {streak}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
