import { DAY_SHORT } from "@/lib/cal";
import { cn } from "@/lib/utils";

/**
 * A round choice pill's look: plain, or (chosen) tinted and ringed in a color (a CSS variable such as
 * "--k-focus"). Used for the item window's kinds and the focus timer's lengths.
 */
export function choicePill(on: boolean, cssVar: string, className?: string) {
  return {
    className: cn("h-9 rounded-full border text-[13px] font-medium transition-colors",
      on ? "border-transparent text-foreground" : "text-muted-foreground hover-elevate", className),
    style: on ? { background: `hsl(var(${cssVar}) / .16)`, boxShadow: `inset 0 0 0 1.5px hsl(var(${cssVar}))` } : undefined,
  };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Days of the week as pills, from the first day of the week (0 is Sunday). With `minOne`, the last
 * day picked stays on.
 */
export function WeekdayPills({ value, onChange, weekStartsOn = 0, minOne = false, label, testId, className }: {
  value: number[];
  onChange: (days: number[]) => void;
  weekStartsOn?: number;
  minOne?: boolean;
  label: string;
  /** Each pill's test id is this plus its day number. */
  testId: string;
  className?: string;
}) {
  const order = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
  return (
    <div className={cn("flex gap-1.5", className)} role="group" aria-label={label}>
      {order.map((d) => {
        const on = value.includes(d);
        return (
          <button type="button" key={d} aria-pressed={on} aria-label={DAY_NAMES[d]}
            onClick={() => {
              if (on && minOne && value.length === 1) return;
              onChange(on ? value.filter((x) => x !== d) : [...value, d].sort());
            }}
            className={cn("h-9 flex-1 rounded-full border text-xs font-medium",
              on ? "bg-primary text-primary-foreground border-transparent" : "text-muted-foreground hover-elevate")}
            data-testid={`${testId}${d}`}>
            {DAY_SHORT[d].slice(0, 2)}
          </button>
        );
      })}
    </div>
  );
}
