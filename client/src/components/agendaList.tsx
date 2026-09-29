import { Fragment, useEffect, useMemo, useState } from "react";
import type { Item, Settings } from "@shared/schema";
import { usePlanner } from "@/components/planner";
import { accentOf } from "@/components/taskTags";
import { useSettings } from "@/lib/data";
import { KIND_META, addDays, colorOf, fmtDate, kindOf, parseYmd, tint, todayStr } from "@/lib/cal";
import { agendaFor, type AgendaEntry as Entry } from "@/lib/today";
import { cn } from "@/lib/utils";

/**
 * The agenda view (laid out like Google Calendar's): days in order, each with its date on the left
 * and its items as cards like the timeline's: all-day ones first, then by time. Days with nothing on are left out, except
 * today. A heading marks each new month.
 */

/** An item as the timeline draws it: a tint of its color, its accent along the left, and its kind's icon. */
export function AgendaItem({ e, settings, compact = false }: { e: Entry; settings: Settings; compact?: boolean }) {
  const { openDetails } = usePlanner();
  const k = kindOf(e.i);
  const Icon = KIND_META[k].icon;
  return (
    <button type="button" onClick={() => openDetails(e.i, e.occ)}
      className={cn("block w-full min-w-0 rounded-md text-left hover-elevate", compact ? "px-2.5 py-1.5" : "px-3 py-2", e.done && "opacity-55")}
      style={{ background: tint(e.i, k === "sleep" ? 0.1 : 0.15), borderLeft: `3px solid ${accentOf(e.i, settings)}` }}
      data-testid={`agenda-item-${e.key}`}>
      <div className={cn("flex items-center gap-1.5 font-medium leading-tight", e.done && "line-through")}>
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: colorOf(e.i) }} />
        <span className="truncate text-sm">{e.i.title}</span>
      </div>
      {(e.time || e.i.location) && (
        <div className="mt-0.5 truncate text-xs text-muted-foreground tnum">
          {[e.time, e.i.location].filter(Boolean).join(" · ")}
        </div>
      )}
    </button>
  );
}

/** Where "now" falls in today's list: a line in the color theme with a dot at its start. */
function NowMarker() {
  return (
    <div className="flex items-center py-0.5" role="separator" aria-label="Now" data-testid="agenda-now">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
      <span className="h-0.5 flex-1 rounded-full bg-primary" />
    </div>
  );
}

/** The time of day in minutes, refreshed every half minute. */
function useNowMinutes(on: boolean) {
  const read = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const [m, setM] = useState(read);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setM(read()), 30000);
    return () => clearInterval(t);
  }, [on]);
  return m;
}

/**
 * Days from `from` for `days` days. `limit` stops after that many items. Each day's row carries
 * data-day, so a page can find which day is in view or scroll to one. With `now`, today's row shows
 * where the current time falls among its items.
 */
export function AgendaList({ list, from, days, limit, compact = false, emptyToday = "Nothing planned", dates = true, always = false, now = true }: {
  list: Item[]; from: string; days: number; limit?: number; compact?: boolean; emptyToday?: string;
  /** Show each day's date on the left (off for a single day's list). */
  dates?: boolean;
  /** Show every day in the range, even with nothing on (not just today). */
  always?: boolean;
  now?: boolean;
}) {
  const { settings } = useSettings();
  const today = todayStr();
  const rows = useMemo(() => {
    const out: { day: string; entries: Entry[] }[] = [];
    let count = 0;
    for (let n = 0; n < days && (limit == null || count < limit); n++) {
      const day = addDays(from, n);
      let entries = agendaFor(list, day);
      if (limit != null) entries = entries.slice(0, limit - count);
      count += entries.length;
      if (entries.length || day === today || always) out.push({ day, entries });
    }
    return out;
  }, [list, from, days, limit, always, today]);
  const nowMin = useNowMinutes(now && rows.some((r) => r.day === today));
  return (
    <div className="grid gap-3" data-testid="agenda-list">
      {rows.map(({ day, entries }, index) => {
        const d = parseYmd(day);
        const isToday = day === today;
        const newMonth = !compact && (index === 0 || parseYmd(rows[index - 1].day).getMonth() !== d.getMonth());
        // Now goes before the first item still to start (all-day ones sit above it).
        const at = !now || !isToday ? -1 : (() => { const k = entries.findIndex((e) => e.start > nowMin); return k < 0 ? entries.length : k; })();
        return (
          <div key={day} className="grid gap-2" data-day={day}>
            {newMonth && (
              <h3 className={cn("text-sm font-semibold text-muted-foreground", index > 0 && "pt-2")}>{fmtDate(day, { month: "long", year: "numeric" })}</h3>
            )}
            <div className="flex gap-3" data-testid={`agenda-day-${day}`}>
              {dates && (
                <div className={cn("w-11 shrink-0 pt-1 text-center leading-none", isToday ? "text-primary" : "text-foreground")}>
                  <div className={cn("font-semibold tnum", compact ? "text-lg" : "text-2xl")}>{d.getDate()}</div>
                  <div className={cn("mt-1 text-xs", isToday ? "font-semibold" : "text-muted-foreground")}>{fmtDate(day, { weekday: "short" })}</div>
                </div>
              )}
              <div className="grid min-w-0 flex-1 gap-1.5">
                {entries.length === 0 && <div className="py-2 text-sm text-muted-foreground">{emptyToday}</div>}
                {entries.map((e, k) => (
                  <Fragment key={e.key}>
                    {k === at && <NowMarker />}
                    <AgendaItem e={e} settings={settings} compact={compact} />
                  </Fragment>
                ))}
                {at >= 0 && at === entries.length && <NowMarker />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
