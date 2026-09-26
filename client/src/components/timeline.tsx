import { useEffect, useRef, useState } from "react";
import type { Item } from "@shared/schema";
import { useEditOccurrence, usePlanner } from "./planner";
import { useItemMutations, useSettings } from "@/lib/data";
import {
  KIND_META,
  blocksForDay,
  colorOf,
  fmtTime,
  fromMin,
  kindOf,
  layoutBlocks,
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
}: {
  day: string;
  items: Item[];
  hourPx?: number;
  compact?: boolean;
  showNow?: boolean;
  showRoutines?: boolean;
  bedMin?: number;
  wakeMin?: number;
}) {
  const { settings } = useSettings();
  const sun = sunTimes(day, settings.lat, settings.lng);
  const { openEditor, openDetails, startFocus, askRepeatScope } = usePlanner();
  const editOccurrence = useEditOccurrence();
  const { update, toggle } = useItemMutations();
  const blocks = layoutBlocks(blocksForDay(items, day));
  const routineBlocks = showRoutines ? blocksForDay(routineSchedules(settings), day) : [];
  const isToday = day === todayStr();
  const [now, setNow] = useState(nowMin());
  useEffect(() => {
    const t = setInterval(() => setNow(nowMin()), 30000);
    return () => clearInterval(t);
  }, []);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pendingRef = useRef<PendingDrag | null>(null);
  const suppressClickRef = useRef(false);
  const colRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => { if (pendingRef.current?.timer) clearTimeout(pendingRef.current.timer); }, []);

  const pxToMin = (px: number) => (px / hourPx) * 60;

  const onGridClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const m = Math.max(0, Math.min(1439, Math.round(pxToMin(e.clientY - rect.top))));
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
        toast({ title: "Synced items cannot be moved!" });
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
    const delta = Math.round(pxToMin(dy) / 5) * 5;
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
      changes = { startTime: fromMin(Math.max(0, Math.min(1425, s))), endTime: fromMin(e) };
    } else {
      const e = Math.max(b.start + 15, d.e0 + d.delta);
      changes = { endTime: fromMin(Math.min(e, 1440 - 1)) };
    }
    // Moving a repeating item asks whether to move just this day or every repeat (habits move as a whole).
    if (recOf(i).freq !== "none" && kindOf(i) !== "habit") {
      void askRepeatScope().then((scope) => {
        if (scope === "one") void editOccurrence(i, b.occDate, changes);
        else if (scope === "all") update.mutate({ id: i.id, ...changes });
      });
      return;
    }
    update.mutate({ id: i.id, ...changes });
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
      <div className="pointer-events-none absolute inset-0" style={{ background: skyGradient(sun.sunrise, sun.sunset) }} aria-hidden />
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
          <span className="block max-w-full truncate text-[10px] sm:text-xs font-medium" style={{ color: colorOf(b.item) }}>
            {b.item.title}
          </span>
        </div>
      ))}
      {!compact && !sun.polar && (
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

      {blocks.map(({ b, col, cols }) => {
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
              "group absolute overflow-hidden rounded-md text-left select-none touch-none",
              lifted ? "z-20 shadow-lg cursor-grabbing" : "cursor-pointer hover:z-10",
              b.done && "opacity-55",
              (b.continues === "after" || b.continues === "through") && "rounded-b-none",
              (b.continues === "before" || b.continues === "through") && "rounded-t-none",
            )}
            style={{
              top: b.continues === "before" || b.continues === "through" ? 0 : top + 1,
              height: h + (b.continues === "before" || b.continues === "through" ? 1 : 0) + (b.continues === "after" || b.continues === "through" ? 1 : 0),
              left: `calc(${(col / cols) * 100}% + ${gap}px)`,
              width: `calc(${100 / cols}% - ${gap * 2}px)`,
              // While lifted, a solid card under the tint keeps the grid from showing through.
              background: lifted
                ? `linear-gradient(${tint(b.item, k === "sleep" ? 0.1 : 0.15)}, ${tint(b.item, k === "sleep" ? 0.1 : 0.15)}), hsl(var(--card))`
                : tint(b.item, k === "sleep" ? 0.1 : 0.15),
              transform: lifted ? "scale(1.04)" : undefined,
              borderLeft: `3px solid ${colorOf(b.item)}`,
              boxShadow: active ? `inset 0 0 0 1.5px ${colorOf(b.item)}` : undefined,
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
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className={cn("flex items-center gap-1 font-medium leading-tight", compact ? "text-xs" : "text-sm", b.done && "line-through")}>
                  {!checkable && !compact && <M.icon className="h-3.5 w-3.5 shrink-0" style={{ color: colorOf(b.item) }} />}
                  <span className="truncate whitespace-nowrap">{b.item.title}</span>
                  {recurring && !compact && !tiny && <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  {b.item.autoTimer && !tiny && <Timer className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Timer starts automatically" />}
                </div>
                {!tiny && (
                  <div className={cn("text-xs text-muted-foreground tnum truncate", compact && "hidden sm:block")}>
                    {b.continues === "before" || b.continues === "through"
                      ? b.continues === "through" ? "continues" : "until " + fmtTime(b.item.endTime, true)
                      : `${fmtTime(fromMin(s), true)} – ${b.continues === "after" && !live ? (b.item.endDate && b.item.endDate > b.occDate ? `ends ${b.item.endDate}` : fmtTime(b.item.endTime, true) + " next day") : fmtTime(fromMin(e), true)}`}
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
              </div>
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
            {b.continues !== "before" && b.continues !== "through" && !b.item.source.startsWith("feed:") && (
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
