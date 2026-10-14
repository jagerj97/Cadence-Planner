import { useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "@shared/schema";
import { useSaveItem, usePlanner } from "./planner";
import { accentOf } from "./taskTags";
import { useItemMutations, useSettings } from "@/lib/data";
import {
  KIND_META,
  addDays,
  fmtDate,
  blocksForDay,
  colorOf,
  fmtTime,
  fromMin,
  kindOf,
  arrangeBlocks,
  nowMin,
  recOf,
  skyGradient,
  routineSchedules,
  sunTimes,
  tint,
  toMin,
  todayStr,
} from "@/lib/cal";
import type { Block } from "@/lib/cal";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { haptic } from "@/lib/haptics";
import { Check, Play, Repeat, Sunrise, Sunset, Timer } from "lucide-react";

export const HOUR_PX = 60;

export function HourLabels({ hourPx = HOUR_PX, narrow = false }: { hourPx?: number; narrow?: boolean }) {
  return (
    <div className={cn("relative shrink-0 select-none", narrow ? "w-9 sm:w-14" : "w-14")} style={{ height: hourPx * 24 }} aria-hidden>
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className={cn("absolute -translate-y-1/2 text-muted-foreground tnum", narrow ? "right-0.5 sm:right-2 text-[10px] sm:text-xs" : "right-2 text-xs")} style={{ top: h * hourPx }}>
          {h === 0 ? "" : fmtTime(h * 60, true)}
        </div>
      ))}
    </div>
  );
}

type Drag = { key: string; mode: "move" | "resize"; y0: number; s0: number; e0: number; delta: number; moved: boolean };
type PendingDrag = Drag & { x0: number; pointerId: number; timer: ReturnType<typeof setTimeout> | null };

export function DayColumn({
  day,
  items,
  hourPx = HOUR_PX,
  compact = false,
  showNow = true,
  showRoutines = true,
  labelContinued = true,
}: {
  day: string;
  items: Item[];
  hourPx?: number;
  compact?: boolean;
  showNow?: boolean;
  showRoutines?: boolean;
  /** Label the part of an overnight item (or routine) carried on from the day before; the week view
   *  leaves it unlabelled after its first day, so a night reads as one item. */
  labelContinued?: boolean;
  bedMin?: number;
  wakeMin?: number;
}) {
  const { settings } = useSettings();
  const sun = sunTimes(day, settings.lat, settings.lng);
  const { openEditor, openDetails, startFocus } = usePlanner();
  const saveItem = useSaveItem();
  const { toggle } = useItemMutations();
  // Overlaps are laid out like Google Calendar: an item that starts once the one under it has room
  // for its title and time (about 36px) is drawn on top, indented; closer starts go side by side.
  const blocks = useMemo(() => arrangeBlocks(blocksForDay(items, day), Math.ceil((36 / hourPx) * 60)), [items, day, hourPx]);
  const routineBlocks = useMemo(() => showRoutines ? blocksForDay(routineSchedules(settings), day) : [], [showRoutines, settings, day]);
  const isToday = day === todayStr();
  // Only today's column keeps the time (other days have no now line to move).
  const [now, setNow] = useState(nowMin());
  useEffect(() => {
    if (!isToday) return;
    setNow(nowMin());
    const t = setInterval(() => setNow(nowMin()), 30000);
    return () => clearInterval(t);
  }, [isToday]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pendingRef = useRef<PendingDrag | null>(null);
  const suppressClickRef = useRef(false);
  const colRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => { if (pendingRef.current?.timer) clearTimeout(pendingRef.current.timer); }, []);
  // Dragging on the timeline, items included, scrolls it; only once a hold has picked an item up does
  // moving drag the item instead. (Scrolling first cancels the hold, through pointercancel.)
  useEffect(() => {
    const el = colRef.current;
    if (!el) return;
    const hold = (e: TouchEvent) => { if (dragRef.current && e.cancelable) e.preventDefault(); };
    el.addEventListener("touchmove", hold, { passive: false });
    return () => el.removeEventListener("touchmove", hold);
  }, []);

  const pxToMin = (px: number) => (px / hourPx) * 60;

  const onGridClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // To the nearest quarter hour, like dragging.
    const m = Math.max(0, Math.min(1425, Math.round(pxToMin(e.clientY - rect.top) / 15) * 15));
    openEditor({ date: day, startTime: fromMin(m), endTime: fromMin(m + 60), kind: "event" });
  };

  const beginDrag = (e: React.PointerEvent, b: Block, mode: "move" | "resize") => {
    if (b.continues === "before" || b.continues === "through") return;
    e.stopPropagation();
    if (pendingRef.current?.timer) clearTimeout(pendingRef.current.timer);
    suppressClickRef.current = false;
    if (b.item.source.startsWith("feed:")) {
      // Synced items are read-only: a long hold warns instead of starting a drag.
      const locked: PendingDrag = {
        key: b.key, mode, x0: e.clientX, y0: e.clientY, s0: b.start, e0: b.end,
        delta: 0, moved: false, pointerId: e.pointerId, timer: null,
      };
      locked.timer = setTimeout(() => {
        if (pendingRef.current !== locked) return;
        pendingRef.current = null;
        suppressClickRef.current = true;
        haptic("warn");
        toast({ title: "Synced items cannot be moved!", variant: "destructive" });
      }, 750);
      pendingRef.current = locked;
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pending: PendingDrag = {
      key: b.key, mode, x0: e.clientX, y0: e.clientY, s0: b.start, e0: b.end,
      delta: 0, moved: false, pointerId: e.pointerId, timer: null,
    };
    pending.timer = setTimeout(() => {
      if (pendingRef.current !== pending) return;
      pending.timer = null;
      dragRef.current = pending;
      setDrag(pending);
      haptic("hold");
    }, 750);
    pendingRef.current = pending;
  };
  const onMove = (e: React.PointerEvent) => {
    const pending = pendingRef.current;
    if (!pending || pending.pointerId !== e.pointerId) return;
    const dy = e.clientY - pending.y0;
    if (pending.timer) {
      if (Math.abs(dy) > 8 || Math.abs(e.clientX - pending.x0) > 8) {
        clearTimeout(pending.timer);
        pendingRef.current = null;
        suppressClickRef.current = true;
      }
      return;
    }
    const current = dragRef.current;
    if (!current) return;
    // Snap to the quarter hour: the new start (moving) or end (resizing) lands on :00, :15, :30 or :45.
    const edge = current.mode === "move" ? current.s0 : current.e0;
    const delta = Math.round((edge + pxToMin(dy)) / 15) * 15 - edge;
    if (Math.abs(dy) > 4 || current.moved) {
      dragRef.current = { ...current, delta, moved: true };
      setDrag(dragRef.current);
    }
  };
  const endDrag = (b: Block) => {
    if (pendingRef.current?.timer) clearTimeout(pendingRef.current.timer);
    pendingRef.current = null;
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    suppressClickRef.current = true;
    if (!d.moved) {
      openDetails(b.item, b.occDate);
      return;
    }
    if (d.delta === 0) return;
    haptic("tick");
    const i = b.item;
    let changes: Partial<Item>;
    if (d.mode === "move") {
      const s = toMin(i.startTime) + d.delta;
      const e = toMin(i.endTime || fromMin(toMin(i.startTime) + 30)) + d.delta;
      changes = { startTime: fromMin(Math.max(0, Math.min(1425, s))), endTime: kindOf(i) === "task" ? null : fromMin(e) };
    } else {
      const e = Math.max(b.start + 15, d.e0 + d.delta);
      changes = { endTime: fromMin(Math.min(e, 1440 - 1)) };
    }
    // A repeating item asks whether to move just this day or every repeat.
    void saveItem(i, changes, b.occDate);
  };
  const cancelDrag = () => {
    if (pendingRef.current?.timer) clearTimeout(pendingRef.current.timer);
    pendingRef.current = null;
    dragRef.current = null;
    setDrag(null);
    suppressClickRef.current = true;
  };

  return (
    <div
      ref={colRef}
      className="relative flex-1 min-w-0 timeline-grid"
      style={{ height: hourPx * 24, backgroundSize: `100% ${hourPx}px` }}
      onClick={onGridClick}
      data-testid={`column-day-${day}`}
    >
      {/* sky: sunrise / sunset gradient */}
      {settings.showSun && <div className="pointer-events-none absolute inset-0" style={{ background: skyGradient(sun.sunrise, sun.sunset) }} aria-hidden />}
      {routineBlocks.map((b) => (
        <div
          key={b.key}
          role="img"
          aria-label={`${b.item.title} routine, ${fmtTime(b.item.startTime)} to ${fmtTime(b.item.endTime)}`}
          data-testid={`routine-${day}-${b.item.id}-${b.start}`}
          // Routines are a background overlay: taps go through to the grid to add an item.
          className="pointer-events-none absolute inset-x-0 flex items-start overflow-hidden border-l-2 border-dashed px-1 pt-1 sm:px-2 text-left select-none"
          style={{
            top: (b.start / 60) * hourPx,
            height: ((b.end - b.start) / 60) * hourPx,
            background: tint(b.item, .12),
            borderColor: colorOf(b.item),
          }}
        >
          {(labelContinued || (b.continues !== "before" && b.continues !== "through")) && (
            <span className="block max-w-full truncate text-[10px] sm:text-xs font-medium" style={{ color: colorOf(b.item) }}>
              {b.item.title}
            </span>
          )}
        </div>
      ))}
      {!compact && !sun.polar && settings.showSun && (
        <>
          {[
            { m: sun.sunrise, I: Sunrise, label: "Sunrise" },
            { m: sun.sunset, I: Sunset, label: "Sunset" },
          ].map(({ m, I, label }) => (
            <div key={label} className="pointer-events-none absolute right-2 flex items-center gap-1 text-xs text-muted-foreground tnum" style={{ top: (m / 60) * hourPx - 9 }}>
              <I className="h-3.5 w-3.5 text-primary" />
              {label} {fmtTime(Math.round(m), true)}
            </div>
          ))}
        </>
      )}

      {blocks.map(({ b, col, cols, depth }) => {
        const k = kindOf(b.item);
        const M = KIND_META[k];
        const live = drag?.key === b.key && drag.moved ? drag : null;
        // Picked up once the hold completes: grows and lifts like items being reordered (SortableList).
        const lifted = drag?.key === b.key;
        let s = b.start, e = b.end;
        if (live?.mode === "move") {
          s += live.delta;
          e += live.delta;
        } else if (live?.mode === "resize") e = Math.max(s + 15, e + live.delta);
        const top = (s / 60) * hourPx;
        const h = Math.max(((e - s) / 60) * hourPx - 2, 18);
        const tiny = h < 34;
        const checkable = k === "task" || k === "habit";
        const recurring = recOf(b.item).freq !== "none";
        const active = isToday && now >= b.start && now < b.end;
        const gap = compact ? 2 : 4;
        const indent = depth * (compact ? 8 : 14);
        // Drawn on top of another item: solid, with a thin edge in the card color to set it apart.
        const nested = depth > 0;
        const fill = tint(b.item, k === "sleep" ? 0.1 : 0.15);
        return (
          <div
            key={b.key}
            role="button"
            tabIndex={0}
            aria-label={`${b.item.title}, ${fmtTime(b.item.startTime)} to ${fmtTime(b.item.endTime)}`}
            onPointerDown={(ev) => beginDrag(ev, b, "move")}
            onPointerMove={onMove}
            onPointerUp={() => endDrag(b)}
            onPointerCancel={cancelDrag}
            onContextMenu={(ev) => ev.preventDefault()}
            onClick={(ev) => {
              ev.stopPropagation();
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              openDetails(b.item, b.occDate);
            }}
            onKeyDown={(ev) => ev.key === "Enter" && openDetails(b.item, b.occDate)}
            className={cn(
              "group absolute overflow-hidden rounded-md text-left select-none",
              lifted ? "z-20 shadow-lg cursor-grabbing" : "cursor-pointer hover:z-10",
              b.done && "opacity-55",
              (b.continues === "after" || b.continues === "through") && "rounded-b-none",
              (b.continues === "before" || b.continues === "through") && "rounded-t-none",
            )}
            style={{
              top: b.continues === "before" || b.continues === "through" ? 0 : top + 1,
              height: h + (b.continues === "before" || b.continues === "through" ? 1 : 0) + (b.continues === "after" || b.continues === "through" ? 1 : 0),
              left: `calc(${(col / cols) * 100}% + ${gap + indent}px)`,
              width: `calc(${100 / cols}% - ${gap * 2 + indent}px)`,
              zIndex: lifted ? undefined : nested ? depth : undefined,
              // While lifted, a solid card under the tint keeps what's behind from showing through. On top of
              // another item it stays see-through like the rest, over a light veil of the card so its text reads.
              background: lifted ? `linear-gradient(${fill}, ${fill}), hsl(var(--card))` : nested ? `linear-gradient(${fill}, ${fill}), hsl(var(--card) / .55)` : fill,
              transform: lifted ? "scale(1.04)" : undefined,
              borderLeft: `3px solid ${accentOf(b.item, settings)}`,
              boxShadow: [active && `inset 0 0 0 1.5px ${accentOf(b.item, settings)}`, nested && "0 0 0 1px hsl(var(--card))"].filter(Boolean).join(", ") || undefined,
            }}
            data-testid={`block-${b.key}`}
          >
            <div className={cn("flex h-full gap-1.5", tiny ? "items-center px-1.5" : compact ? "px-1 py-1 sm:px-2" : "px-2 py-1")}>
              {checkable && !compact && (
                <button
                  type="button"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    toggle.mutate({ id: b.item.id, date: b.occDate });
                  }}
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0 rounded grid place-items-center border",
                    tiny && "mt-0",
                  )}
                  style={{ borderColor: colorOf(b.item), background: b.done ? colorOf(b.item) : "transparent" }}
                  aria-label={b.done ? "Mark not done" : "Mark done"}
                  data-testid={`button-check-${b.key}`}
                >
                  {b.done && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
                </button>
              )}
              {(labelContinued || (b.continues !== "before" && b.continues !== "through")) && <div className="min-w-0 flex-1 overflow-hidden">
                <div className={cn("flex items-center gap-1 font-medium leading-tight", compact ? "text-xs" : "text-sm", b.done && "line-through")}>
                  {!checkable && !compact && <M.icon className="h-3.5 w-3.5 shrink-0" style={{ color: colorOf(b.item) }} />}
                  {/* Narrow columns (the week) let a title take two lines when there's room. */}
                  <span className={cn(compact && !tiny && h >= 44 ? "line-clamp-2 [overflow-wrap:anywhere]" : "truncate whitespace-nowrap")}>{b.item.title}</span>
                  {recurring && !compact && !tiny && <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  {b.item.autoTimer && !tiny && <Timer className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Timer starts automatically" />}
                </div>
                {!tiny && (
                  <div className={cn("text-xs text-muted-foreground tnum truncate", compact && "text-[10px] sm:text-xs")}>
                    {b.continues === "before" || b.continues === "through"
                      ? b.continues === "through" ? "continues" : "until " + fmtTime(b.item.endTime, true)
                      : <>
                          {/* A narrow column (the week on a phone) has room for the start only. */}
                          {compact && <span className="sm:hidden">{fmtTime(fromMin(s), true)}</span>}
                          <span className={cn(compact && "hidden sm:inline")}>{`${fmtTime(fromMin(s), true)} – ${b.continues === "after" && !live ? (b.item.endDate && b.item.endDate > addDays(b.occDate, 1)
                            ? `ends ${fmtDate(b.item.endDate, { month: "short", day: "numeric" })}, ${fmtTime(b.item.endTime, true)}`
                            : fmtTime(b.item.endTime, true) + " next day") : fmtTime(fromMin(e), true)}`}</span>
                        </>}
                    {b.item.location && !compact ? ` · ${b.item.location}` : ""}
                  </div>
                )}
                {b.item.notes?.trim() && h >= (compact ? 64 : 56) && (
                  <p
                    className={cn("mt-0.5 text-xs leading-snug text-muted-foreground/70 whitespace-pre-line overflow-hidden", compact && "hidden sm:[display:-webkit-box]")}
                    style={{ display: compact ? undefined : "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: Math.max(1, Math.floor((h - (compact ? 40 : 42)) / 16)) }}
                    data-testid={`text-notes-${b.key}`}
                  >
                    {b.item.notes.trim()}
                  </p>
                )}
              </div>}
              {!compact && k !== "sleep" && !tiny && (
                <button
                  type="button"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    startFocus({ title: b.item.title, itemId: b.item.id, minutes: Math.max(5, b.end - b.start) });
                  }}
                  className="self-start mt-0.5 h-6 w-6 shrink-0 grid place-items-center rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-background/60"
                  aria-label={`Start timer for ${b.item.title}`}
                  data-testid={`button-play-${b.key}`}
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* The resize handle; tasks have no end to drag (they're due at their time). */}
            {b.continues !== "before" && b.continues !== "through" && !b.item.source.startsWith("feed:") && k !== "task" && (
              <div
                className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                onPointerDown={(ev) => beginDrag(ev, b, "resize")}
                onPointerMove={onMove}
                onPointerCancel={(ev) => { ev.stopPropagation(); cancelDrag(); }}
                onPointerUp={(ev) => {
                  ev.stopPropagation();
                  endDrag(b);
                }}
                aria-hidden
              />
            )}
          </div>
        );
      })}

      {isToday && showNow && (
        <div className="pointer-events-none absolute inset-x-0 z-30 flex items-center" style={{ top: (now / 60) * hourPx }} aria-hidden>
          <div className="h-2.5 w-2.5 -ml-1 rounded-full bg-primary" />
          <div className="h-[1.5px] flex-1 bg-primary" />
        </div>
      )}
    </div>
  );
}
