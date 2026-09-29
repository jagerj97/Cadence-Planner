import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Minutes as the digits typed for them ("114" for 1:14), without leading zeros. */
const digitsOf = (minutes: number | null) =>
  minutes ? String(Math.floor(minutes / 60) * 100 + (minutes % 60)) : "";
/** Up to four typed digits as minutes: the last two are minutes (which may be over 59), the rest hours. */
const minutesOf = (digits: string) => (digits ? Math.floor(Number(digits) / 100) * 60 + (Number(digits) % 100) : null);
const shown = (digits: string) => {
  if (!digits) return "";
  const d = digits.padStart(4, "0");
  return `${d.slice(0, 2)}:${d.slice(2)}`;
};

/**
 * A length of time typed as hrs:mins ("00:00"). Digits fill in from the right, like a timer: typing
 * 1, 1, 4 reads 00:01, 00:11, 01:14. Backspace takes off the last digit. Empty while it's being typed
 * (value null); on leaving the box it's tidied up (00:90 becomes 01:30) and emptiness is reported
 * once more so the caller can fall back to a default.
 */
export function DurationInput({ value, onChange, onBlur, className, invalid, id, testId }: {
  value: number | null; onChange: (minutes: number | null) => void; onBlur?: (minutes: number | null) => void;
  className?: string; invalid?: boolean; id?: string; testId?: string;
}) {
  const [digits, setDigits] = useState(() => digitsOf(value));
  const ref = useRef<HTMLInputElement>(null);
  // Follow the value when it's changed from outside (a preset button, a default).
  useEffect(() => {
    if (minutesOf(digits) !== value) setDigits(digitsOf(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: string) => {
    setDigits(next);
    onChange(minutesOf(next));
    // Typing always happens at the end.
    requestAnimationFrame(() => { const el = ref.current; if (el) el.setSelectionRange(el.value.length, el.value.length); });
  };
  return (
    <Input
      ref={ref}
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="00:00"
      value={shown(digits)}
      // Keyboards differ in the keys they report, so work from the text: a typed digit lands at the end,
      // a deleted one is gone. Leading zeros drop off, and only the last four digits count.
      onChange={(e) => set(e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(-4))}
      onFocus={() => requestAnimationFrame(() => { const el = ref.current; if (el) el.setSelectionRange(el.value.length, el.value.length); })}
      onBlur={() => {
        const minutes = minutesOf(digits);
        setDigits(digitsOf(minutes));
        onBlur?.(minutes);
      }}
      className={cn("tnum text-right", className)}
      aria-invalid={invalid}
      aria-label="Hours and minutes"
      data-testid={testId}
    />
  );
}
