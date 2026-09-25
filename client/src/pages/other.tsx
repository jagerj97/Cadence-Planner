import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shell";
import { usePlanner, Ring, clock, chime } from "@/components/planner";
import { TZ, useFeeds, useItemMutations, useItems, useSaveSettings, useSessions, useSettings } from "@/lib/data";
import { API_BASE, apiRequest, queryClient } from "@/lib/queryClient";
import {
  DAY_SHORT,
  KIND_META,
  addDays,
  bestStreak,
  blocksForDay,
  colorOf,
  completionsOf,
  fmtDate,
  fmtDur,
  fmtTime,
  kindOf,
  markOf,
  occursOn,
  orderHabits,
  parseYmd,
  rateOf,
  recLabel,
  streakOf,
  sunTimes,
  todayStr,
} from "@/lib/cal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { haptic } from "@/lib/haptics";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COLOR_THEMES, IMPORT_KINDS } from "@shared/schema";
import type { ColorTheme, ImportKind, Routine, Settings } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { SiGooglecalendar, SiApple } from "react-icons/si";
import {
  Plus,
  Flame,
  Trophy,
  Check,
  Play,
  Pause,
  Square,
  RefreshCw,
  Trash2,
  Upload,
  Download,
  Link2,
  Bell,
  Timer,
  Calendar as CalIcon,
  AlertCircle,
  ExternalLink,
  MapPin,
  Sunrise,
  Sunset,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Copy,
} from "lucide-react";

/* ====================== HABITS ====================== */
const MARK_LABEL = ["not done", "half done", "done"] as const;
/** empty, half (diagonal / split), or solid */
export function fillOf(mk: 0 | 1 | 2, color: string, angle = 135) {
  if (mk === 2) return color;
  if (mk === 1) return `linear-gradient(${angle}deg, ${color} 50%, transparent 50%)`;
  return "transparent";
}
// Play Music-style "album art" colours for habit cards
const ART = ["#F4511E", "#8E24AA", "#1E88E5", "#00897B", "#43A047", "#FB8C00", "#3949AB", "#D81B60", "#6D4C41", "#00ACC1"];
export function HabitsPage() {
  const { data: items } = useItems();
  const { cycle } = useItemMutations();
  const saveOrder = useSaveSettings();
  const { openEditor } = usePlanner();
  const { settings } = useSettings();
  const today = todayStr();
  const [span, setSpan] = useState(28);
  const habits = orderHabits((items ?? []).filter((i) => kindOf(i) === "habit"), settings);
  const dueNow = habits.filter((h) => occursOn(h, today));
  // Reorders within the habits shown today, swapping with the nearest visible neighbor.
  const moveHabit = async (id: number, direction: -1 | 1) => {
    const order = habits.map((h) => h.id);
    const visible = dueNow.map((h) => h.id);
    const at = visible.indexOf(id), neighbor = visible[at + direction];
    if (at < 0 || neighbor == null) return;
    const from = order.indexOf(id), to = order.indexOf(neighbor);
    [order[from], order[to]] = [order[to], order[from]];
    await saveOrder.mutateAsync({ habitOrder: order });
  };
  const doneToday = dueNow.filter((h) => completionsOf(h).has(today)).length;
  // newest first, like writing down the page
  const first = habits.reduce((m, h) => (h.date < m ? h.date : m), today);
  const all = Math.max(1, Math.round((parseYmd(today).getTime() - parseYmd(first).getTime()) / 864e5) + 1);
  const days = Array.from({ length: Math.min(span, all) }, (_, n) => addDays(today, -n));
  const weekStart = settings.weekStartsOn ?? 0;

  return (
    <>
      <PageHeader title="Habits" sub={dueNow.length ? `${doneToday} of ${dueNow.length} done today` : "Build routines that stick"}>
        <Button variant="outline" onClick={() => openEditor({ kind: "habit", date: today, recurrence: '{"freq":"daily"}' })} data-testid="button-add-habit">
          <Plus className="h-4 w-4 mr-1.5" />
          New habit
        </Button>
      </PageHeader>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
        {habits.length === 0 ? (
          <Empty
            icon={<Flame className="h-5 w-5" />}
            title="No habits yet"
            body="Habits are recurring items you check off. Add one like “Meditate 10 min every day” and watch the streak grow."
          />
        ) : (
          <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start">
            {/* today: one tap per habit */}
            <section className="card-md wellness-habits" aria-label="Today">
              <h2 className="px-4 pt-4 pb-2 text-base font-semibold tracking-tight">Today</h2>
              {dueNow.length === 0 && (
                <p className="px-4 pb-4 text-sm text-muted-foreground" data-testid="text-no-habits-today">No habits scheduled today.</p>
              )}
              <ul className="pb-2">
                {dueNow.map((h) => {
                  const due = occursOn(h, today);
                  const mk = markOf(h, today);
                  const hit = mk === 2;
                  const st = streakOf(h, today);
                  return (
                    <li key={h.id} className="flex items-center gap-3 px-4 py-2.5" data-testid={`row-habit-${h.id}`}>
                      <button
                        onClick={() => due && cycle.mutate({ id: h.id, date: today })}
                        disabled={!due}
                        className={cn(
                          "h-7 w-7 shrink-0 rounded-full grid place-items-center border-2 transition-colors",
                          !due && "border-dashed opacity-40",
                        )}
                        style={{ borderColor: colorOf(h), background: fillOf(mk, colorOf(h), 90) }}
                        aria-label={!due ? `${h.title} isn't scheduled today` : `${h.title}: ${MARK_LABEL[mk]}. Tap for ${MARK_LABEL[((mk + 1) % 3) as 0 | 1 | 2]}`}
                        data-testid={`button-toggle-habit-${h.id}`}
                      >
                        {hit && <Check className="h-4 w-4 text-background" strokeWidth={3} />}
                      </button>
                      <button onClick={() => openEditor(h)} className="min-w-0 flex-1 text-left">
                        <div className={cn("text-sm font-medium truncate", hit && "text-muted-foreground")}>{h.title}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {due ? recLabel(h) : "Not today"}
                          {h.startTime ? ` · ${fmtTime(h.startTime, true)}` : ""}
                        </div>
                      </button>
                      <div className="shrink-0 text-right text-xs tnum leading-tight">
                        <div className={cn("inline-flex items-center gap-0.5 font-medium", st > 0 ? "text-[hsl(var(--k-task))]" : "text-muted-foreground")} title="Current streak">
                          <Flame className="h-3.5 w-3.5" />
                          {st}
                        </div>
                        <div className="text-muted-foreground" title="Best streak · last 30 days">
                          best {bestStreak(h, today)} · {Math.round(rateOf(h, today) * 100)}%
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col" aria-label={`Reorder ${h.title}`}>
                        <Button size="icon" variant="ghost" className="h-6 w-7" disabled={dueNow[0]?.id === h.id || saveOrder.isPending}
                          onClick={() => moveHabit(h.id, -1)} aria-label={`Move ${h.title} up`} data-testid={`button-habit-up-${h.id}`}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-7" disabled={dueNow[dueNow.length - 1]?.id === h.id || saveOrder.isPending}
                          onClick={() => moveHabit(h.id, 1)} aria-label={`Move ${h.title} down`} data-testid={`button-habit-down-${h.id}`}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* tracker: days run down the page, one narrow column per habit */}
            <section className="card-md" aria-label="Habit tracker">
              <div className="flex items-baseline justify-between gap-2 px-4 pt-4 pb-2">
                <h2 className="text-base font-semibold tracking-tight">Tracker</h2>
                <span className="text-xs text-muted-foreground">Tap once for half, twice for full</span>
              </div>
              <div className="habit-paper px-2 pb-2">
                <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
                  <colgroup>
                    <col className="w-[68px]" />
                    {habits.map((h) => (
                      <col key={h.id} />
                    ))}
                  </colgroup>
                  <thead className="sticky -top-4 md:-top-6 z-10 [&_th]:bg-card">
                    <tr>
                      <th />
                      {habits.map((h) => (
                        <th key={h.id} className="h-20 md:h-36 align-bottom pb-2 font-medium" scope="col">
                          <button
                            onClick={() => openEditor(h)}
                            className="mx-auto block max-h-16 md:max-h-32 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground hover:text-foreground [writing-mode:vertical-rl] rotate-180"
                            title={h.title}
                            data-testid={`header-habit-${h.id}`}
                          >
                            {h.title}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => {
                      const dt = parseYmd(d);
                      const weekEdge = dt.getDay() === weekStart && d !== today;
                      const isT = d === today;
                      return (
                        <tr key={d} className={cn(weekEdge && "[&>td]:border-b [&>td]:border-foreground/15")}>
                          <td className={cn("py-1 pl-2 pr-1 text-xs tnum whitespace-nowrap", isT ? "font-semibold text-primary" : "text-muted-foreground")}>
                            <span className="inline-block w-7">{DAY_SHORT[dt.getDay()].slice(0, 2)}</span>
                            <span className={cn(dt.getDate() === 1 && "font-semibold text-foreground")}>
                              {dt.getDate() === 1 ? fmtDate(d, { month: "short" }) + " 1" : dt.getDate()}
                            </span>
                          </td>
                          {habits.map((h) => {
                            const due = occursOn(h, d) && d >= h.date;
                            const mk = markOf(h, d);
                            const hit = mk === 2;
                            return (
                              <td key={h.id} className={cn("py-1 text-center", isT && "bg-primary/5")}>
                                {due ? (
                                  <button
                                    onClick={() => cycle.mutate({ id: h.id, date: d })}
                                    className={cn(
                                      "inline-grid h-6 w-6 place-items-center rounded-[5px] border-[1.5px] transition-colors",
                                      mk === 0 && "hover:bg-muted",
                                    )}
                                    style={{ background: fillOf(mk, colorOf(h), 135), borderColor: mk ? colorOf(h) : "hsl(var(--foreground) / .22)" }}
                                    aria-label={`${h.title}, ${fmtDate(d, { weekday: "short", month: "short", day: "numeric" })}: ${MARK_LABEL[mk]}`}
                                    data-testid={`button-habit-${h.id}-${d}`}
                                  >
                                    {hit && <Check className="h-3.5 w-3.5 text-background" strokeWidth={3} />}
                                  </button>
                                ) : (
                                  <span className="inline-block h-1 w-1 rounded-full bg-foreground/20" aria-label="Not scheduled" />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {all > span && <div className="flex justify-center pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setSpan((n) => n + 28)} data-testid="button-habits-more">
                    Show 4 more weeks
                  </Button>
                </div>}
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  );
}

function Empty({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-sm text-center py-16 grid gap-2 justify-items-center">
      <div className="h-10 w-10 rounded-full bg-muted grid place-items-center text-muted-foreground">{icon}</div>
      <div className="font-medium">{title}</div>
      <p className="text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}

/* ====================== FOCUS ====================== */
export function FocusPage() {
  const { focus, elapsed, startFocus, pauseFocus, resumeFocus, stopFocus, addFocusTime } = usePlanner();
  const { settings } = useSettings();
  const { data: items } = useItems();
  const { data: sessions } = useSessions();
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState(String(settings.focusMinutes));
  useEffect(() => setDuration(String(settings.focusMinutes)), [settings.focusMinutes]);
  const minutes = Number(duration);
  const validDuration = duration.trim() !== "" && Number.isInteger(minutes) && minutes >= 1 && minutes <= 720;
  const today = todayStr();

  const upcoming = useMemo(() => {
    const nm = new Date().getHours() * 60 + new Date().getMinutes();
    return blocksForDay(items ?? [], today)
      .filter((b) => b.end > nm && kindOf(b.item) !== "sleep" && b.continues !== "before")
      .slice(0, 6);
  }, [items, today]);

  const todays = (sessions ?? []).filter((s) => s.date === today);
  const totalToday = todays.reduce((a, s) => a + s.actualSec, 0) / 60;
  const week = Array.from({ length: 7 }, (_, n) => addDays(today, n - 6)).map((d) => ({
    d,
    min: (sessions ?? []).filter((s) => s.date === d).reduce((a, s) => a + s.actualSec, 0) / 60,
  }));
  const maxWeek = Math.max(60, ...week.map((w) => w.min));

  const remaining = focus ? focus.plannedSec - elapsed : (validDuration ? minutes : 0) * 60;
  const pct = focus ? elapsed / focus.plannedSec : 0;
  const ringColor = focus?.mode === "break" ? "hsl(var(--k-habit))" : "hsl(var(--k-focus))";

  return (
    <>
      <PageHeader title="Focus" sub={`${fmtDur(totalToday)} focused today · ${todays.length} session${todays.length === 1 ? "" : "s"}`} />
      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
          <section className="card-md p-6 md:p-10 grid justify-items-center gap-6" aria-label="Timer">
            <div className="relative">
              <Ring pct={pct} size={260} stroke={10} color={ringColor} />
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <div className="font-mono text-5xl tnum tracking-tight" data-testid="text-timer">
                    {clock(remaining)}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 max-w-[180px] truncate">
                    {focus ? (focus.mode === "break" ? "Break" : focus.title) : "Ready"}
                  </div>
                </div>
              </div>
            </div>

            {focus ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => addFocusTime(5)} data-testid="button-timer-add5">
                  +5 min
                </Button>
                {focus.runStart ? (
                  <Button onClick={pauseFocus} data-testid="button-timer-pause">
                    <Pause className="h-4 w-4 mr-1.5" /> Pause
                  </Button>
                ) : (
                  <Button onClick={resumeFocus} data-testid="button-timer-resume">
                    <Play className="h-4 w-4 mr-1.5" /> Resume
                  </Button>
                )}
                <Button variant="outline" onClick={() => stopFocus(true)} data-testid="button-timer-finish">
                  <Check className="h-4 w-4 mr-1.5" /> Finish
                </Button>
                <Button variant="ghost" onClick={() => stopFocus(false)} aria-label="Stop" data-testid="button-timer-stop">
                  <Square className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 w-full max-w-md">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What are you focusing on?" className="h-11 text-base" data-testid="input-focus-label" />
                <div className="flex gap-1.5" role="radiogroup" aria-label="Duration">
                  {[10, 30, 60, 90].map((m) => (
                    <button
                      key={m}
                      role="radio"
                      aria-checked={validDuration && minutes === m}
                      onClick={() => setDuration(String(m))}
                      className={cn(
                        "flex-1 h-10 rounded-md border text-sm tnum",
                        minutes === m ? "bg-primary text-primary-foreground border-transparent font-medium" : "hover-elevate text-muted-foreground",
                      )}
                      data-testid={`button-duration-${m}`}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
                <label className="flex items-center justify-between gap-3 text-sm" htmlFor="input-focus-duration">
                  <span className="font-medium">Custom duration</span>
                  <span className="flex items-center gap-2">
                    <Input
                      id="input-focus-duration"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={720}
                      step={1}
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      className="h-10 w-24 text-right tnum"
                      aria-invalid={!validDuration}
                      data-testid="input-focus-duration"
                    />
                    <span className="text-muted-foreground">minutes</span>
                  </span>
                </label>
                {!validDuration && <p className="text-xs text-destructive">Enter a whole number from 1 to 720 minutes.</p>}
                <Button size="lg" disabled={!validDuration} onClick={() => startFocus({ title: label.trim() || "Focus session", minutes })} data-testid="button-start-focus">
                  <Play className="h-4 w-4 mr-1.5" /> {validDuration ? `Start ${minutes}-minute focus` : "Start focus"}
                </Button>
              </div>
            )}
          </section>

          <aside className="grid content-start gap-4">
            <div className="card-md">
              <h2 className="text-sm font-semibold px-4 pt-3 pb-2">Start from your plan</h2>
              {upcoming.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-muted-foreground">Nothing else scheduled today.</p>
              ) : (
                <ul className="pb-2">
                  {upcoming.map((b) => (
                    <li key={b.key} className="flex items-center gap-2.5 px-4 py-1.5">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colorOf(b.item) }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{b.item.title}</div>
                        <div className="text-xs text-muted-foreground tnum">
                          {fmtTime(b.start, true)} · {fmtDur(b.end - b.start)}
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => startFocus({ title: b.item.title, itemId: b.item.id, minutes: Math.max(5, b.end - b.start) })}
                        aria-label={`Start timer for ${b.item.title}`}
                        data-testid={`button-focus-${b.key}`}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card-md p-4">
              <h2 className="text-sm font-semibold mb-3">Last 7 days</h2>
              <div className="flex items-end gap-2 h-28" role="img" aria-label="Focus minutes per day">
                {week.map((w) => (
                  <div key={w.d} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <div
                      className="w-full rounded-sm"
                      style={{ height: `${Math.max(3, (w.min / maxWeek) * 100)}%`, background: w.min ? "hsl(var(--k-focus))" : "hsl(var(--border))" }}
                      title={`${fmtDur(w.min)} on ${w.d}`}
                    />
                    <span className={cn("text-xs", w.d === today ? "text-foreground font-medium" : "text-muted-foreground")}>
                      {DAY_SHORT[parseYmd(w.d).getDay()].slice(0, 2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-md">
              <h2 className="text-sm font-semibold px-4 pt-3 pb-2">Today's sessions</h2>
              {todays.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-muted-foreground">Finished sessions show up here.</p>
              ) : (
                <ul className="pb-2">
                  {todays.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 px-4 py-1.5 text-sm" data-testid={`row-session-${s.id}`}>
                      <Timer className="h-3.5 w-3.5 text-[hsl(var(--k-focus))]" />
                      <span className="truncate flex-1">{s.title}</span>
                      <span className="text-xs text-muted-foreground tnum">
                        {new Date(s.startedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · {fmtDur(s.actualSec / 60)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

/* ====================== SYNC ====================== */
const FEED_COLORS = ["#4f6bd8", "#0b8a6a", "#c2562b", "#8a4fd8", "#b8860b", "#d8457a"];
const IMPORT_LABELS: Record<ImportKind, string> = {
  event: "Events",
  task: "Tasks",
  meeting: "Meetings",
  habit: "Habits",
  focus: "Focus blocks",
};

function ImportTypePicker({ id, value, onChange }: {
  id: string;
  value: "auto" | ImportKind;
  onChange: (value: "auto" | ImportKind) => void;
}) {
  return (
    <div className="grid gap-1.5 w-full sm:max-w-60">
      <Label htmlFor={id}>Import items as</Label>
      <Select value={value} onValueChange={(next) => onChange(next as "auto" | ImportKind)}>
        <SelectTrigger id={id} data-testid={id} aria-label="Import items as">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Auto-detect from calendar</SelectItem>
          {IMPORT_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{IMPORT_LABELS[kind]}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CalendarLinks() {
  const isAndroid = !!window.CadenceAndroid;
  const { data: subscription, isLoading: loadingSubscription } = useQuery<{ path: string }>({
    queryKey: ["/api/calendar-link"], enabled: !isAndroid,
  });
  const { data: feeds } = useFeeds();
  const { data: items } = useItems();
  const { toast } = useToast();
  const [name, setName] = useState("Calendar");
  const [url, setUrl] = useState("");
  const [feedKind, setFeedKind] = useState<"auto" | ImportKind>("auto");
  const [fileKind, setFileKind] = useState<"auto" | ImportKind>("auto");
  const [busy, setBusy] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const syncFeed = async (id: number, quiet = false) => {
    setBusy(id);
    try {
      const r = await apiRequest("POST", `/api/feeds/${id}/sync`, { tz: TZ });
      const f = await r.json();
      if (!quiet) toast({ title: "Calendar synced", description: `${f.eventCount} events from ${f.name}` });
    } catch (e: any) {
      toast({ title: "Sync failed", description: String(e.message).replace(/^\d+: /, "").replace(/^\{"message":"|".*$/g, ""), variant: "destructive" });
    } finally {
      setBusy(null);
      queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    }
  };

  const addFeed = async () => {
    if (!url.trim()) return;
    setAdding(true);
    try {
      const color = FEED_COLORS[(feeds?.length ?? 0) % FEED_COLORS.length];
      const f = await (await apiRequest("POST", "/api/feeds", {
        name: name.trim() || "Calendar", url: url.trim(), color,
        importKind: feedKind === "auto" ? null : feedKind,
      })).json();
      queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
      setUrl("");
      await syncFeed(f.id);
    } catch (e: any) {
      const message = String(e.message).replace(/^\d+: /, "");
      let description = message;
      try { description = JSON.parse(message).message || message; } catch { /* network error */ }
      toast({ title: "Couldn't connect calendar", description, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const onFile = async (file: File) => {
    setImporting(true);
    try {
      const ics = await file.text();
      const r = await (await apiRequest("POST", "/api/import", {
        ics, tz: TZ, importKind: fileKind === "auto" ? null : fileKind,
      })).json();
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Import complete", description: `${r.imported} items added from ${file.name}` });
    } catch (e: any) {
      toast({ title: "Import failed", description: String(e.message).replace(/^\d+: /, ""), variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const localCount = (items ?? []).filter((i) => !i.source.startsWith("feed:")).length;
  const exportUrl = `${API_BASE}/api/export.ics?tz=${encodeURIComponent(TZ)}`;
  const exportAllUrl = `${exportUrl}&feeds=1`;
  const exportOnDevice = async (includeFeeds: boolean) => {
    try {
      const url = `/api/export.ics?tz=${encodeURIComponent(TZ)}${includeFeeds ? "&feeds=1" : ""}`;
      window.CadenceAndroid?.saveIcs(await (await apiRequest("GET", url)).text());
    } catch {
      toast({ title: "Could not export calendar", variant: "destructive" });
    }
  };
  const subscriptionUrl = subscription ? `${window.location.origin}${API_BASE}${subscription.path}` : "";
  const [rotating, setRotating] = useState(false);
  const rotateLink = async () => {
    setRotating(true);
    try {
      const next = await (await apiRequest("POST", "/api/calendar-link/rotate")).json();
      queryClient.setQueryData(["/api/calendar-link"], next);
      toast({ title: "Subscription link changed", description: "The previous link no longer works." });
    } catch {
      toast({ title: "Could not rotate link", variant: "destructive" });
    } finally { setRotating(false); }
  };

  return (
    <>
          {isAndroid ? <section className="card-md p-5 grid gap-2">
            <h2 className="text-sm font-semibold">Your calendar stays on this phone</h2>
            <p className="text-sm text-muted-foreground">You can import subscribed calendars and save an iCal file below. A phone-only calendar cannot provide a public subscription URL that Google Calendar can reach.</p>
          </section> : <section className="card-md p-5 grid gap-3 content-start">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Subscribe to Cadence</h2>
            </div>
            <p className="text-sm text-muted-foreground">Add this URL to Google Calendar under “From URL” to subscribe to your Cadence items. Changes appear when your calendar app refreshes its subscriptions.</p>
            <div className="flex min-w-0 gap-2">
              <Input readOnly aria-label="Cadence iCal subscription URL" value={subscriptionUrl} placeholder={loadingSubscription ? "Preparing link…" : "Unavailable"} data-testid="input-calendar-link" />
              <Button variant="outline" size="icon" disabled={!subscriptionUrl} aria-label="Copy subscription link" onClick={async () => {
                try { await navigator.clipboard.writeText(subscriptionUrl); toast({ title: "Link copied" }); }
                catch { toast({ title: "Select and copy the link above" }); }
              }} data-testid="button-copy-calendar-link"><Copy className="h-4 w-4" /></Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" disabled={!subscriptionUrl || rotating} onClick={rotateLink} data-testid="button-rotate-calendar-link">
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Replace link
              </Button>
              <span className="text-xs text-muted-foreground">Anyone with this link can read exported items, including notes. Replace it to revoke the old link.</span>
            </div>
            <p className="text-xs text-muted-foreground">If this app is behind a private site access gate, outside calendar services may not be able to reach this link.</p>
          </section>}
          {/* subscribe */}
          <section id="calendars" className="card-md p-5 grid gap-4 content-start">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Connected calendars</h2>
              <span className="ml-auto text-xs text-muted-foreground">Auto-syncs every 15 min while open</span>
            </div>

            <div className="rounded-md bg-muted/60 p-4 text-sm grid gap-2">
              <div className="flex items-center gap-2 font-medium">
                <SiGooglecalendar className="h-4 w-4 text-[#4285F4]" />
                Connect Google Calendar
              </div>
              <ol className="list-decimal pl-5 grid gap-1 text-muted-foreground">
                <li>
                  Open{" "}
                  <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                    Google Calendar settings
                  </a>
                  .
                </li>
                <li>Under “Settings for my calendars”, pick your calendar → “Integrate calendar”.</li>
                <li>Copy the <span className="text-foreground font-medium">Secret address in iCal format</span> and paste it below.</li>
              </ol>
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
              <SiApple className="h-3.5 w-3.5" /> Add an internet-accessible iCal subscription URL, including webcal links. {isAndroid ? "The phone app requires HTTPS." : "Use HTTPS for private links;"} One-time .ics files can be uploaded below.
              </div>
            </div>

            <div className="grid sm:grid-cols-[160px_1fr] gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Calendar name" data-testid="input-feed-name" />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFeed()}
                placeholder="https://example.com/calendar.ics or webcal://…"
                aria-label="Calendar iCal URL"
                data-testid="input-feed-url"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <ImportTypePicker id="select-feed-import-kind" value={feedKind} onChange={setFeedKind} />
              <Button onClick={addFeed} disabled={!url.trim() || adding} data-testid="button-add-feed">
                <Link2 className="h-4 w-4 mr-1.5" />
                {adding ? "Connecting…" : "Connect"}
              </Button>
            </div>

            {feeds && feeds.length > 0 ? (
              <ul className="grid gap-2">
                {feeds.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 rounded-md border px-3 py-2.5" data-testid={`row-feed-${f.id}`}>
                    <span className="h-3 w-3 rounded-full shrink-0" style={{
                      background: f.importKind ? `hsl(var(${KIND_META[f.importKind].cssVar}))` : f.color,
                    }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{f.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {f.lastError ? (
                          <span className="text-destructive inline-flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" /> {f.lastError}
                          </span>
                        ) : f.lastSynced ? (
                          `${f.eventCount} items · ${f.importKind ? `as ${IMPORT_LABELS[f.importKind].toLowerCase()}` : "auto-detected"} · synced ${new Date(f.lastSynced).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                        ) : (
                          "Not synced yet"
                        )}
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => syncFeed(f.id)} disabled={busy === f.id} aria-label="Sync now" data-testid={`button-sync-${f.id}`}>
                      <RefreshCw className={cn("h-4 w-4", busy === f.id && "animate-spin")} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        await apiRequest("DELETE", `/api/feeds/${f.id}`);
                        queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
                        queryClient.invalidateQueries({ queryKey: ["/api/items"] });
                        toast({ title: "Calendar removed", description: f.name });
                      }}
                      aria-label="Remove calendar"
                      data-testid={`button-remove-feed-${f.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No calendars connected yet. Synced events appear in your day with their calendar's color.</p>
            )}
          </section>

          {/* import */}
          <section className="card-md p-5 grid gap-3 content-start">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Import a file</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Upload any .ics file (Google: Settings → Import &amp; export → Export). Imported items are editable in Cadence, and repeating
              items keep their schedule.
            </p>
            <input ref={fileRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} data-testid="input-file-ics" />
            <ImportTypePicker id="select-file-import-kind" value={fileKind} onChange={setFileKind} />
            <div>
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing} data-testid="button-import">
                <Upload className="h-4 w-4 mr-1.5" />
                {importing ? "Importing…" : "Choose .ics file"}
              </Button>
            </div>
          </section>

          {/* export */}
          <section className="card-md p-5 grid gap-3 content-start">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Export</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Download your {localCount} Cadence items as an .ics file, then import it into Google Calendar (Settings → Import &amp; export → Import).
              Repeats, reminders and notes are included.
            </p>
            <div className="flex flex-wrap gap-2">
              {isAndroid ? <Button onClick={() => exportOnDevice(false)} data-testid="button-export">
                <Download className="h-4 w-4 mr-1.5" /> Save my plan
              </Button> : <Button asChild data-testid="button-export">
                <a href={exportUrl} target="_blank" rel="noopener noreferrer">
                  <Download className="h-4 w-4 mr-1.5" />
                  Export my plan
                </a>
              </Button>}
              {isAndroid ? <Button variant="outline" onClick={() => exportOnDevice(true)} data-testid="button-export-all">
                Include synced calendars
              </Button> : <Button asChild variant="outline" data-testid="button-export-all">
                <a href={exportAllUrl} target="_blank" rel="noopener noreferrer">
                  Include synced calendars
                </a>
              </Button>}
            </div>
          </section>
    </>
  );
}

/** keeps feeds fresh while the app is open */
export function useAutoSync() {
  const { data: feeds } = useFeeds();
  useEffect(() => {
    if (!feeds?.length) return;
    const run = async () => {
      for (const f of feeds) {
        try {
          await apiRequest("POST", `/api/feeds/${f.id}/sync`, { tz: TZ });
        } catch {
          /* shown on sync page */
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feeds"] });
    };
    const t = setInterval(run, 15 * 60 * 1000);
    return () => clearInterval(t);
  }, [feeds?.length]); // eslint-disable-line
}

/* ====================== SETTINGS ====================== */
function BackupRestore({ beforeBackup }: { beforeBackup: () => Promise<void> }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<{
    name: string; text: string; summary: string;
  } | null>(null);

  const backup = async () => {
    setBusy(true);
    try {
      await beforeBackup();
      const text = await (await apiRequest("GET", "/api/backup")).text();
      if (new TextEncoder().encode(text).length > 25 * 1024 * 1024) throw new Error("Backup exceeds the 25 MB file limit");
      window.CadenceAndroid?.saveBackup(text);
    } catch (cause) {
      toast({ title: "Could not create backup", description: String(cause), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const selectFile = async (file: File) => {
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("Choose a backup smaller than 25 MB");
      const text = await file.text();
      const data = JSON.parse(text);
      if (data?.format !== "cadence-android-backup" || data.version !== 1 ||
          !data.tables || !["items", "feeds", "journal", "sessions", "settings"]
            .every((key) => Array.isArray(data.tables[key]))) {
        throw new Error("This is not a supported Cadence Android backup");
      }
      const { items, feeds, journal, sessions } = data.tables;
      setCandidate({
        name: file.name, text,
        summary: `${items.length} ${items.length === 1 ? "item" : "items"}, ` +
          `${journal.length} journal ${journal.length === 1 ? "entry" : "entries"}, ` +
          `${sessions.length} focus ${sessions.length === 1 ? "session" : "sessions"}, ` +
          `${feeds.length} calendar ${feeds.length === 1 ? "subscription" : "subscriptions"}`,
      });
    } catch (cause) {
      toast({ title: "Cannot open backup", description: cause instanceof Error ? cause.message : "Invalid file", variant: "destructive" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const restore = async () => {
    if (!candidate) return;
    setBusy(true);
    try {
      await apiRequest("POST", "/api/backup/restore", JSON.parse(candidate.text));
      window.location.reload();
    } catch (cause) {
      let message = String(cause).replace(/^\w+: \d+: /, "");
      try { message = JSON.parse(message).message || message; } catch { /* keep error text */ }
      toast({ title: "Restore failed", description: message, variant: "destructive" });
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Save a complete, unencrypted copy of your phone's planner. It includes journal entries,
        habit progress, settings, focus history, and calendar subscription URLs. Keep this file private.
        Your settings are saved automatically; the backup includes the latest changes.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={backup} disabled={busy} data-testid="button-backup-save">
          <Download className="h-4 w-4 mr-2" /> Save backup
        </Button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
          data-testid="input-backup-file"
          onChange={(event) => event.target.files?.[0] && void selectFile(event.target.files[0])} />
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}
          data-testid="button-backup-restore">
          <Upload className="h-4 w-4 mr-2" /> Restore from file
        </Button>
      </div>
      <Dialog open={!!candidate} onOpenChange={(open) => { if (!open && !busy) setCandidate(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Replace data on this phone?</DialogTitle>
            <DialogDescription>
              Restoring {candidate?.name} will remove the current planner data from this phone and replace it
              with the contents of the backup. This cannot be undone unless you saved another backup.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-xl bg-muted p-3 text-sm">{candidate?.summary}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setCandidate(null)} disabled={busy}
              data-testid="button-backup-cancel">Cancel</Button>
            <Button variant="destructive" onClick={restore} disabled={busy}
              data-testid="button-backup-confirm">{busy ? "Restoring…" : "Replace phone data"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Injected at build time by vite.android.config.ts; the web dev build doesn't define them.
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const APP_BUILD = typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "";

export function SettingsPage() {
  const { settings, isLoading } = useSettings();
  const save = useSaveSettings();
  const { toast } = useToast();
  const { theme, setTheme } = usePlanner();
  const [locating, setLocating] = useState(false);
  const isAndroid = !!window.CadenceAndroid;
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [perm, setPerm] = useState<string>(() => window.CadenceAndroid
    ? window.CadenceAndroid.notificationsAllowed() ? "granted" : "prompt"
    : ("Notification" in window ? Notification.permission : "unsupported"));
  useEffect(() => {
    if (!window.CadenceAndroid) return;
    const refresh = () => setPerm(window.CadenceAndroid?.notificationsAllowed() ? "granted" : "prompt");
    window.addEventListener("cadence-notification-permission", refresh);
    return () => window.removeEventListener("cadence-notification-permission", refresh);
  }, []);
  const [draft, setDraft] = useState(settings);
  useEffect(() => {
    if (isLoading) return;
    if (!isAndroid || !hydrated) {
      setDraft(settings);
      setHydrated(true);
    }
  }, [settings, isLoading, isAndroid, hydrated]);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const lastQueued = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveVersion = useRef(0);
  const normalized = (value: Settings): Settings => {
    const sleep = value.routines.find((r) => r.id === "sleep");
    return { ...value, ...(sleep ? { bedTime: sleep.startTime, wakeTime: sleep.endTime } : {}) };
  };
  const flushAndroidSettings = (): Promise<void> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const payload = normalized(latestDraft.current);
    const serialized = JSON.stringify(payload);
    if (serialized === lastQueued.current) return saveQueue.current;
    lastQueued.current = serialized;
    const version = ++saveVersion.current;
    queryClient.setQueryData(["/api/settings"], payload);
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      await apiRequest("PUT", "/api/settings", payload);
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      if (version === saveVersion.current) setSaveStatus("saved");
    }).catch((error) => {
      if (version === saveVersion.current) {
        lastQueued.current = "";
        setSaveStatus("error");
      }
      throw error;
    });
    return saveQueue.current;
  };
  const flushRef = useRef(flushAndroidSettings);
  flushRef.current = flushAndroidSettings;
  useEffect(() => {
    if (!isAndroid || !hydrated) return;
    const serialized = JSON.stringify(normalized(draft));
    if (lastQueued.current === null) {
      lastQueued.current = serialized;
      return;
    }
    if (serialized === lastQueued.current) return;
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushRef.current().catch(() => {}); }, 300);
  }, [draft, hydrated, isAndroid]);
  useEffect(() => () => {
    if (isAndroid && saveTimer.current) void flushRef.current().catch(() => {});
  }, [isAndroid]);

  const updateRoutine = (id: string, fields: Partial<Routine>) => setDraft((d) => ({
    ...d, routines: d.routines.map((r) => r.id === id ? { ...r, ...fields } : r),
  }));

  const onSave = async () => {
    try {
      await save.mutateAsync(normalized(draft));
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Settings saved" });
    } catch {
      toast({ title: "Couldn't save settings", description: "Check your routine names, colors and time ranges.", variant: "destructive" });
    }
  };

  const askPermission = async () => {
    try {
      if (window.CadenceAndroid) {
        window.CadenceAndroid.requestNotifications();
        setPerm(window.CadenceAndroid.notificationsAllowed() ? "granted" : "prompt");
        return;
      }
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p === "granted") new Notification("Notifications are on", { body: "Cadence will ping you before events." });
    } catch {
      setPerm("blocked");
    }
  };

  if (isLoading) return null;
  return (
    <>
      <PageHeader title="Settings" sub="Make Cadence fit how you live">
        {isAndroid
          ? <span role="status" className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="settings-save-status">
              {saveStatus === "saved" ? "Saved automatically" : saveStatus === "saving" ? "Saving…" : "Couldn't save"}
              {saveStatus === "error" && <button type="button" className="text-primary underline" onClick={() => {
                setSaveStatus("saving");
                void flushAndroidSettings().catch(() => {});
              }}>Retry</button>}
            </span>
          : <Button onClick={onSave} disabled={save.isPending} data-testid="button-save-settings">
              Save changes
            </Button>}
      </PageHeader>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
        <div className="grid gap-4 max-w-3xl">
          <Section title="You">
            <Field label="Your name">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="input-name" />
            </Field>
          </Section>

          <Section title="Routine settings" hint="Background time ranges on every day, including past days. These are not events." defaultOpen>
            <div className="grid gap-3">
              {draft.routines.map((r) => (
                <div key={r.id} className="rounded-xl border bg-background/70 p-3 grid gap-3" data-testid={`routine-${r.id}`}>
                  <div className="flex items-center gap-2">
                    <Input className="min-w-0 flex-1 font-medium" value={r.name} aria-label="Routine name"
                      onChange={(e) => updateRoutine(r.id, { name: e.target.value })} data-testid={`input-routine-name-${r.id}`} />
                    <input type="color" value={r.color} aria-label={`${r.name} color`}
                      className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border bg-transparent p-1"
                      onChange={(e) => updateRoutine(r.id, { color: e.target.value })} data-testid={`input-routine-color-${r.id}`} />
                    <Button size="icon" variant="ghost" className="shrink-0" aria-label={`Remove ${r.name} routine`}
                      onClick={() => setDraft((d) => ({ ...d, routines: d.routines.filter((entry) => entry.id !== r.id) }))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="From">
                      <Input type="time" step={60} value={r.startTime} aria-label={`${r.name} start time`}
                        onChange={(e) => updateRoutine(r.id, { startTime: e.target.value })} data-testid={`input-routine-start-${r.id}`} />
                    </Field>
                    <Field label="To">
                      <Input type="time" step={60} value={r.endTime} aria-label={`${r.name} end time`}
                        onChange={(e) => updateRoutine(r.id, { endTime: e.target.value })} data-testid={`input-routine-end-${r.id}`} />
                    </Field>
                  </div>
                  <p className="text-xs text-muted-foreground">{fmtDur((toM(r.endTime) - toM(r.startTime) + 1440) % 1440)} daily{r.endTime < r.startTime ? " · crosses midnight" : ""}</p>
                </div>
              ))}
              <Button variant="outline" className="justify-self-start" onClick={() => setDraft((d) => ({
                ...d,
                routines: [...d.routines, { id: crypto.randomUUID(), name: "New routine", startTime: "09:00", endTime: "10:00",
                  color: "#5966AD" }],
              }))} data-testid="button-add-routine"><Plus className="h-4 w-4 mr-1.5" /> Add routine</Button>
            </div>
          </Section>

          <Section title="Sunrise & sunset" hint={`Colors your timeline with the sky. Using ${draft.place || "your location"} (${draft.lat.toFixed(2)}, ${draft.lng.toFixed(2)}).`}>
            <div className="grid sm:grid-cols-[1fr_140px_140px] gap-3">
              <Field label="Place">
                <Input value={draft.place} onChange={(e) => setDraft({ ...draft, place: e.target.value })} data-testid="input-place" />
              </Field>
              <Field label="Latitude">
                <CoordInput value={draft.lat} limit={90} label="Latitude" onChange={(lat) => setDraft((d) => ({ ...d, lat }))} testId="input-lat" />
              </Field>
              <Field label="Longitude">
                <CoordInput value={draft.lng} limit={180} label="Longitude" onChange={(lng) => setDraft((d) => ({ ...d, lng }))} testId="input-lng" />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={locating}
                onClick={async () => {
                  setLocating(true);
                  try {
                    const { lat, lng } = await getDeviceLocation();
                    setDraft((d) => ({ ...d, lat: +lat.toFixed(4), lng: +lng.toFixed(4), place: "My location" }));
                    toast({ title: "Location found", description: isAndroid ? "Your settings will save automatically." : "Save to update your sunrise and sunset." });
                  } catch (err) {
                    toast({ title: "Couldn't get your location", description: `${(err as Error).message} You can enter latitude and longitude instead.` });
                  } finally {
                    setLocating(false);
                  }
                }}
                data-testid="button-use-location"
              >
                <MapPin className="h-3.5 w-3.5 mr-1.5" />
                {locating ? "Finding you…" : "Use my location"}
              </Button>
              <SunPreview lat={draft.lat} lng={draft.lng} />
            </div>
          </Section>

          <Section title="Reminders & notifications">
            <Field label="Default reminder for new items">
              <Select
                value={draft.defaultReminder == null ? "none" : String(draft.defaultReminder)}
                onValueChange={(v) => setDraft({ ...draft, defaultReminder: v === "none" ? null : Number(v) })}
              >
                <SelectTrigger data-testid="select-default-reminder">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="0">At start time</SelectItem>
                  <SelectItem value="5">5 min before</SelectItem>
                  <SelectItem value="10">10 min before</SelectItem>
                  <SelectItem value="15">15 min before</SelectItem>
                  <SelectItem value="30">30 min before</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Row label="Play a sound" hint="Soft chime for reminders and when a timer ends">
              <Switch checked={draft.sound} onCheckedChange={(v) => setDraft({ ...draft, sound: v })} data-testid="switch-sound" />
            </Row>
            <Row label="Haptic feedback" hint="Vibrate when you pick up an item to move it and when you check off a task or habit">
              <Switch checked={draft.haptics !== false} onCheckedChange={(v) => {
                if (v) haptic("complete", true);
                setDraft((d) => ({ ...d, haptics: v }));
              }} data-testid="switch-haptics" />
            </Row>
            <Row
              label={window.CadenceAndroid ? "Phone notifications" : "Desktop notifications"}
              hint={
                window.CadenceAndroid
                  ? "Allow system notifications for reminders while Cadence is open."
                : perm === "granted"
                  ? "On — you'll get system notifications while Cadence is open."
                  : perm === "denied" || perm === "blocked"
                    ? "Blocked here. In-app alerts and sound still work; allow notifications in your browser, or open Cadence in its own tab."
                    : "In-app alerts always show. Turn this on for system notifications too."
              }
            >
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={askPermission} disabled={perm === "granted" || perm === "unsupported"} data-testid="button-notify-permission">
                  <Bell className="h-3.5 w-3.5 mr-1.5" />
                  {perm === "granted" ? "Enabled" : "Enable"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    chime("soft");
                    toast({ title: "Test reminder", description: "This is how reminders look." });
                    try {
                      if (window.CadenceAndroid) window.CadenceAndroid.notify("Test reminder", "This is how reminders look.");
                      else if (Notification.permission === "granted") new Notification("Test reminder", { body: "This is how reminders look." });
                    } catch {
                      /* noop */
                    }
                  }}
                  data-testid="button-test-notification"
                >
                  Test
                </Button>
              </div>
            </Row>
          </Section>

          <Section title="Focus timer">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default focus (min)">
                <Input type="number" min={5} max={180} value={draft.focusMinutes} onChange={(e) => setDraft({ ...draft, focusMinutes: Number(e.target.value) || 25 })} data-testid="input-focus-min" />
              </Field>
              <Field label="Break (min)">
                <Input type="number" min={1} max={60} value={draft.breakMinutes} onChange={(e) => setDraft({ ...draft, breakMinutes: Number(e.target.value) || 5 })} data-testid="input-break-min" />
              </Field>
            </div>
          </Section>

          <Section title="Calendar links" hint="Subscribe, connect, import and export calendars">
            <CalendarLinks />
          </Section>

          {window.CadenceAndroid && (
            <Section title="Backup & restore" hint="Move all your phone-local Cadence data to a file">
              <BackupRestore beforeBackup={flushAndroidSettings} />
            </Section>
          )}

          <Section title="Calendar view">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Week starts on">
                <Select value={String(draft.weekStartsOn)} onValueChange={(v) => setDraft({ ...draft, weekStartsOn: Number(v) as 0 | 1 })}>
                  <SelectTrigger data-testid="select-week-start">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Sunday</SelectItem>
                    <SelectItem value="1">Monday</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

            </div>
          </Section>
          <Section title="Appearance" hint="Choose a color theme and display mode">
            <div className="flex flex-wrap gap-2" role="group" aria-label="App color theme">
              {COLOR_THEMES.map((name) => (
                <button key={name} type="button" aria-pressed={draft.colorTheme === name}
                  onClick={() => setDraft({ ...draft, colorTheme: name as ColorTheme })}
                  className={cn("inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm text-foreground capitalize transition-colors", draft.colorTheme === name ? "border-primary bg-primary/10 font-semibold" : "hover:bg-muted")}
                  data-testid={`button-theme-${name}`}>
                  <span className="h-4 w-4 rounded-full" style={{ background: {
                    tomato: "#cf493e", orange: "#e66b0a", blueberry: "#4d60ab",
                    plum: "#95549d", avocado: "#6a8229", monochrome: "#62676b",
                  }[name] }} />
                  {name}
                </button>
              ))}
            </div>
            <Row label="Dark mode">
              <Switch checked={isAndroid ? draft.appearanceTheme === "dark" : theme === "dark"} onCheckedChange={(v) => {
                const next = v ? "dark" : "light";
                setTheme(next);
                setDraft((current) => ({ ...current, appearanceTheme: next }));
              }} data-testid="switch-dark" />
            </Row>
          </Section>
          <p className="pt-2 text-center text-xs text-muted-foreground tnum" data-testid="text-app-version">
            Cadence v{APP_VERSION}{APP_BUILD && ` · build ${APP_BUILD}`}
          </p>
        </div>
      </div>
    </>
  );
}
const toM = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};
function Section({ title, hint, children, defaultOpen = false }: { title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className="card-md overflow-hidden">
      <button type="button" aria-expanded={open} aria-controls={id}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)} data-testid={`toggle-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          {hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div id={id} className="grid gap-4 border-t px-4 pb-4 pt-4">{children}</div>}
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
void CalIcon;
void ExternalLink;
void fmtDate;

function SunPreview({ lat, lng }: { lat: number; lng: number }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const t = sunTimes(todayStr(), lat, lng);
  return (
    <span className="flex items-center gap-3 text-sm text-muted-foreground tnum" data-testid="text-sun-preview">
      <span className="inline-flex items-center gap-1">
        <Sunrise className="h-4 w-4 text-primary" /> {fmtTime(Math.round(t.sunrise), true)}
      </span>
      <span className="inline-flex items-center gap-1">
        <Sunset className="h-4 w-4 text-primary" /> {fmtTime(Math.round(t.sunset), true)}
      </span>
      <span>today</span>
    </span>
  );
}

const LOCATION_ERRORS: Record<string, string> = {
  denied: "Location permission was denied. You can allow it in Android Settings › Apps › Cadence › Permissions.",
  disabled: "Location is turned off on this device.",
  timeout: "Finding your location took too long.",
  unavailable: "Your location isn't available right now.",
};

/** Uses the phone's native location on Android (more reliable than the WebView), else the browser. */
function getDeviceLocation(): Promise<{ lat: number; lng: number }> {
  const bridge = window.CadenceAndroid;
  if (bridge?.requestLocation) {
    return new Promise((resolve, reject) => {
      const done = (fn: () => void) => { clearTimeout(timer); window.removeEventListener("cadence-location", onResult); fn(); };
      const onResult = (event: Event) => {
        const detail = (event as CustomEvent).detail || {};
        if (typeof detail.lat === "number" && typeof detail.lng === "number") done(() => resolve({ lat: detail.lat, lng: detail.lng }));
        else done(() => reject(new Error(LOCATION_ERRORS[detail.error] ?? LOCATION_ERRORS.unavailable)));
      };
      const timer = setTimeout(() => done(() => reject(new Error(LOCATION_ERRORS.timeout))), 30000);
      window.addEventListener("cadence-location", onResult);
      bridge.requestLocation!();
    });
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location isn't available in this browser."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? "Location permission was denied."
        : err.code === err.TIMEOUT ? LOCATION_ERRORS.timeout : LOCATION_ERRORS.unavailable)),
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

/** Coordinate field that keeps what's typed (so "-" and "-3" aren't wiped) and has a ± button for keyboards without a minus key. */
function CoordInput({ value, limit, label, onChange, testId }: {
  value: number; limit: number; label: string; onChange: (v: number) => void; testId: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.\-]/g, "").replace(/(?!^)-/g, "");
    setText(cleaned);
    const n = Number(cleaned);
    if (cleaned !== "" && cleaned !== "-" && cleaned !== "." && cleaned !== "-." && Number.isFinite(n)) {
      onChange(Math.max(-limit, Math.min(limit, n)));
    }
  };
  return (
    <div className="flex gap-1">
      <Button type="button" variant="outline" size="icon" className="shrink-0 w-9"
        aria-label={`Flip ${label.toLowerCase()} between positive and negative`}
        onClick={() => commit(text.startsWith("-") ? text.slice(1) : `-${text}`)}
        data-testid={`${testId}-sign`}>±</Button>
      <Input type="text" inputMode="decimal" value={text} aria-label={label}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setText(String(value))}
        data-testid={testId} />
    </div>
  );
}
