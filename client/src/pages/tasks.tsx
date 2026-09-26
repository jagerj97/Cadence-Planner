import { useMemo, useState } from "react";
import type { Item } from "@shared/schema";
import { PageHeader } from "@/components/shell";
import { usePlanner } from "@/components/planner";
import { blankItem, useItemMutations, useItems, useSettings } from "@/lib/data";
import {
  addDays,
  completionsOf,
  fmtDate,
  fmtDur,
  fmtTime,
  isDeadlineTask,
  isTimed,
  kindOf,
  occursOn,
  parseQuick,
  recLabel,
  recOf,
  toMin,
  todayStr,
  taskAvailableFrom,
} from "@/lib/cal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Plus, Check, Play, CornerDownLeft, CheckSquare, Timer, Repeat, Flag } from "lucide-react";

type Row = { i: Item; occ: string; done: boolean };
type Filter = "today" | "upcoming" | "open" | "done";

function nextOcc(i: Item, from: string): string | null {
  let d = from;
  for (let n = 0; n < 120; n++) {
    if (occursOn(i, d) && !completionsOf(i).has(d)) return d;
    d = addDays(d, 1);
  }
  return null;
}

export default function TasksPage() {
  const { data: items, isLoading } = useItems();
  const { openEditor } = usePlanner();
  const [filter, setFilter] = useState<Filter>("today");
  const [showOlder, setShowOlder] = useState(false);
  const today = todayStr();
  const tasks = (items ?? []).filter((i) => kindOf(i) === "task");

  const rows = useMemo(() => {
    const open: Row[] = [];
    const done: Row[] = [];
    for (const i of tasks) {
      const rec = recOf(i).freq !== "none";
      if (!rec) {
        const isDone = completionsOf(i).has(i.date);
        const active = i.date <= today && today <= (i.endDate || i.date);
        (isDone ? done : open).push({ i, occ: active ? today : i.date, done: isDone });
      } else {
        if (occursOn(i, today) && completionsOf(i).has(today)) done.push({ i, occ: today, done: true });
        const n = nextOcc(i, today);
        if (n) open.push({ i, occ: n, done: false });
      }
    }
    const pr = (x: Item) => (x.priority === "high" ? 0 : x.priority === "normal" ? 1 : 2);
    open.sort((a, b) => a.occ.localeCompare(b.occ) || pr(a.i) - pr(b.i) || (a.i.startTime || "99").localeCompare(b.i.startTime || "99"));
    done.sort((a, b) => b.occ.localeCompare(a.occ));
    return { open, done };
  }, [tasks, today]);

  const groups = useMemo(() => {
    const g: { key: string; label: string; rows: Row[] }[] = [];
    const push = (key: string, label: string, r: Row[]) => r.length && g.push({ key, label, rows: r });
    const o = rows.open;
    const overdue = o.filter((r) => r.occ < today);
    const tod = [...o.filter((r) => r.occ === today), ...rows.done.filter((r) => r.occ === today)];
    const available = o.filter((r) => isDeadlineTask(r.i) && r.i.availableFrom! <= today && r.i.date > today);
    const tom = o.filter((r) => r.occ === addDays(today, 1));
    const week = o.filter((r) => r.occ > addDays(today, 1) && r.occ <= addDays(today, 7));
    const later = o.filter((r) => r.occ > addDays(today, 7));
    if (filter === "today") {
      push("overdue", "Overdue", overdue);
      push("today", "Today", tod);
      push("available", "Before due", available);
    } else if (filter === "upcoming") {
      push("tomorrow", "Tomorrow", tom);
      push("week", "Next 7 days", week);
      push("later", "Later", later);
    } else if (filter === "open") {
      // A task you can already do shows under "Before due" only, not again under its due date.
      const shown = new Set(available);
      const notShown = (rows: Row[]) => rows.filter((r) => !shown.has(r));
      push("overdue", "Overdue", overdue);
      push("today", "Today", o.filter((r) => r.occ === today));
      push("available", "Before due", available);
      push("tomorrow", "Tomorrow", notShown(tom));
      push("week", "Next 7 days", notShown(week));
      push("later", "Later", notShown(later));
    } else push("done", "Completed", rows.done);
    return g;
  }, [rows, filter, today]);

  const dueToday = rows.open.filter((r) => r.occ <= today).length;
  const counts: Record<Filter, number> = {
    today: dueToday + rows.open.filter((r) => isDeadlineTask(r.i) && r.i.availableFrom! <= today && r.i.date > today).length,
    upcoming: rows.open.filter((r) => r.occ > today).length,
    open: rows.open.length,
    done: rows.done.length,
  };

  return (
    <>
      <PageHeader title="Tasks" sub={`${rows.open.length} open · ${dueToday} due today`}>
        <Button variant="outline" onClick={() => openEditor({ kind: "task", date: today })} data-testid="button-new-task">
          <Plus className="h-4 w-4 mr-1.5" />
          New task
        </Button>
      </PageHeader>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
        <div className="max-w-3xl grid grid-cols-1 gap-4">
          <TaskQuickAdd />
          <div className="flex gap-1 card-md rounded-[20px] p-1 w-full sm:w-fit" role="tablist" aria-label="Filter tasks">
            {(
              [
                ["today", "Today"],
                ["upcoming", "Upcoming"],
                ["open", "All open"],
                ["done", "Completed"],
              ] as [Filter, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={filter === k}
                onClick={() => setFilter(k)}
                className={cn(
                  "flex-1 sm:flex-none min-w-0 min-h-12 flex flex-col sm:flex-row items-center justify-center gap-0 sm:gap-1.5 rounded-[15px] px-1.5 sm:px-3 py-1.5 text-[13px] sm:text-sm leading-tight transition-colors",
                  filter === k ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover-elevate",
                )}
                data-testid={`tab-tasks-${k}`}
              >
                {l}
                <span className={cn("text-[12px] sm:text-xs tnum", filter === k ? "opacity-80" : "opacity-70")}>{counts[k]}</span>
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="grid gap-2">
              {[0, 1, 2].map((k) => (
                <Skeleton key={k} className="h-14" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="card-md text-center py-14 px-6 grid justify-items-center gap-2">
              <div className="h-10 w-10 rounded-full bg-accent grid place-items-center text-primary">
                <CheckSquare className="h-5 w-5" />
              </div>
              <div className="font-medium">{filter === "done" ? "Nothing completed yet" : filter === "upcoming" ? "Nothing coming up" : "You're all clear"}</div>
              <p className="text-sm text-muted-foreground max-w-xs">Add a task above — give it a time like “3pm” to put it on your timeline, or leave it open for anytime.</p>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.key} className="card-md" aria-label={g.label}>
                <h2 className={cn("flex items-center justify-between px-4 pt-3 pb-1.5 text-sm font-semibold", g.key === "overdue" && "text-destructive")}>
                  {g.label}
                  <span className="text-xs font-normal text-muted-foreground tnum">{g.rows.length}</span>
                </h2>
                {(() => {
                  // Completed tasks dated more than a week ago stay hidden until "Show older" is tapped.
                  const older = g.key === "done" ? g.rows.filter((r) => r.occ < addDays(today, -7)).length : 0;
                  const shown = older && !showOlder ? g.rows.slice(0, g.rows.length - older) : g.rows;
                  return (
                    <>
                      <ul className="pb-1.5">
                        {shown.map((r) => (
                          <TaskRow key={`${r.i.id}:${r.occ}`} r={r} />
                        ))}
                      </ul>
                      {older > 0 && (
                        <button type="button" aria-expanded={showOlder} onClick={() => setShowOlder((v) => !v)}
                          className="w-full border-t px-4 py-2.5 text-center text-xs font-medium text-muted-foreground hover:bg-muted/40"
                          data-testid="button-tasks-show-older">
                          {showOlder ? "Show less" : `Show older (${older})`}
                        </button>
                      )}
                    </>
                  );
                })()}
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function TaskRow({ r }: { r: Row }) {
  const { i, occ, done } = r;
  const { toggle } = useItemMutations();
  const { openDetails, startFocus } = usePlanner();
  const { settings } = useSettings();
  const today = todayStr();

  const dateLabel =
    occ === today ? "Today" : occ === addDays(today, 1) ? "Tomorrow" : occ === addDays(today, -1) ? "Yesterday" : fmtDate(occ, { weekday: "short", month: "short", day: "numeric" });

  const dur = isTimed(i) ? ((toMin(i.endTime) - toMin(i.startTime) + 1440) % 1440) || 30 : settings.focusMinutes;

  return (
    <li className="group flex items-center gap-3 px-4 py-2 hover:bg-muted/50" data-testid={`row-task-${i.id}`}>
      <button
        onClick={() => toggle.mutate({ id: i.id, date: recOf(i).freq === "none" ? i.date : occ })}
        className="h-5 w-5 shrink-0 rounded-md grid place-items-center border-[1.5px] transition-colors"
        style={{ borderColor: "hsl(var(--k-task))", background: done ? "hsl(var(--k-task))" : "transparent" }}
        aria-label={done ? `Mark ${i.title} not done` : `Mark ${i.title} done`}
        data-testid={`button-toggle-task-${i.id}`}
      >
        {done && <Check className="h-3.5 w-3.5 text-background" strokeWidth={3} />}
      </button>
      <button onClick={() => openDetails(i, occ)} className="min-w-0 flex-1 text-left">
        <div className={cn("text-sm fade-truncate", done && "line-through text-muted-foreground")}>{i.title}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className={cn(occ < today && !done && "text-destructive")}>
            {isDeadlineTask(i) ? `Due ${dateLabel}` : i.endDate && i.endDate > i.date && recOf(i).freq === "none"
              ? `${fmtDate(i.date, { month: "short", day: "numeric" })}–${fmtDate(i.endDate, { month: "short", day: "numeric" })}`
              : dateLabel}
          </span>
          {isTimed(i) && <span className="tnum">{fmtTime(i.startTime, true)}–{fmtTime(i.endTime, true)}</span>}
          {i.priority === "high" && (
            <span className="inline-flex items-center gap-0.5 text-primary font-medium">
              <Flag className="h-3 w-3" /> High
            </span>
          )}
          {recOf(i).freq !== "none" && (
            <span className="inline-flex items-center gap-0.5">
              <Repeat className="h-3 w-3" /> {recLabel(i)}
            </span>
          )}
          {i.autoTimer && (
            <span className="inline-flex items-center gap-0.5">
              <Timer className="h-3 w-3" /> Auto timer
            </span>
          )}
        </div>
      </button>
      {!done && (
        <div className="flex items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => startFocus({ title: i.title, itemId: i.id, minutes: dur })}
            aria-label={`Start ${fmtDur(dur)} timer`}
            title={`Start ${fmtDur(dur)} timer`}
            data-testid={`button-focus-task-${i.id}`}
          >
            <Play className="h-4 w-4" />
          </Button>
        </div>
      )}
    </li>
  );
}

function TaskQuickAdd() {
  const [text, setText] = useState("");
  const { create } = useItemMutations();
  const { settings } = useSettings();
  const { toast } = useToast();
  const p = text.trim() ? parseQuick(text, todayStr()) : null;
  const submit = async () => {
    if (!p) return;
    const high = /(^|\s)!(high)?(\s|$)/i.test(text);
    await create.mutateAsync(
      blankItem({
        title: p.title.replace(/(^|\s)!(high)?(\s|$)/i, " ").trim() || p.title,
        kind: "task",
        date: p.date,
        startTime: p.startTime,
        endTime: p.endTime,
        recurrence: JSON.stringify(p.recurrence),
        reminder: p.startTime ? settings.defaultReminder : null,
        availableFrom: taskAvailableFrom(p.date, p.startTime, JSON.stringify(p.recurrence)),
        priority: high ? "high" : "normal",
      }),
    );
    toast({ title: "Task added", description: p.title });
    setText("");
  };
  return (
    <div className="flex items-center gap-2 card-md px-3">
      <Plus className="h-4 w-4 text-primary shrink-0" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Add a task — “Submit report tomorrow 2pm !high” or “Water plants every sat”"
        className="border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-11"
        aria-label="Add a task"
        data-testid="input-task-quick-add"
      />
      {p && (
        <Button size="sm" onClick={submit} disabled={create.isPending} data-testid="button-task-quick-add">
          <CornerDownLeft className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      )}
    </div>
  );
}
