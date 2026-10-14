import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { bounce, burst, reducedMotion as reduced } from "@/components/motion";

/**
 * A row that's just been checked off and won't stay in its list: once the bounce has played, it fades
 * and its gap closes, then `then` makes the change that takes it away.
 */
export async function leaveRow(row: HTMLElement | null, then: () => void) {
  if (!row || reduced()) return then();
  // It starts going once the check has drawn in and the line has crossed it out, and closes up as it fades.
  await new Promise((r) => setTimeout(r, 480));
  const h = row.offsetHeight;
  const opts = { easing: "cubic-bezier(.3,.7,.3,1)", fill: "forwards" as const };
  await row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, ...opts }).finished;
  await row.animate([{ height: `${h}px` }, { height: "0px", paddingTop: "0px", paddingBottom: "0px" }], { duration: 170, ...opts }).finished;
  then();
  // Back as it was if the change didn't take it away after all.
  setTimeout(() => row.isConnected && row.getAnimations().forEach((a) => a.cancel()), 1500);
}

/** A check mark that draws itself in when `on` (pathLength 1, so the dash is the whole stroke). */
function DrawnCheck({ on, className }: { on: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("relative text-background", className)} aria-hidden fill="none" stroke="currentColor"
      strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" pathLength={1} strokeDasharray={1} strokeDashoffset={on ? 0 : 1}
        style={{ transition: "stroke-dashoffset .3s ease-out .08s" }} />
    </svg>
  );
}

/**
 * A task's checkbox. Checking it bounces the box as the check draws in; unchecking just clears it.
 * `onToggle` gets the box, so a row that leaves once done can let the bounce play first.
 */
export function TaskCheck({ done, color, onToggle, label, className, checkClassName, testId }: {
  done: boolean; color: string; onToggle: (box: HTMLButtonElement) => void; label: string;
  className?: string; checkClassName?: string; testId?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button ref={ref} type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!done) void bounce(ref.current);
        onToggle(ref.current!);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn("relative shrink-0 grid place-items-center overflow-hidden transition-colors", className)}
      style={{ borderColor: color, background: done ? color : "transparent", willChange: "transform" }}
      aria-label={label} aria-pressed={done} data-testid={testId}>
      <DrawnCheck on={done} className={checkClassName} />
    </button>
  );
}

/** How much of a habit's circle is filled, as the half-done diagonal: the top-left half, then all of it. */
const FILL = [
  "polygon(0 0, 0 0, 0 0, 0 0, 0 0)",
  "polygon(0 0, 100% 0, 100% 0, 0 100%, 0 100%)",
  "polygon(0 0, 100% 0, 100% 100%, 100% 100%, 0 100%)",
];

/**
 * A habit's circle: tapped, it goes half done, done, then clear. Its fill sweeps across on the
 * diagonal, with a small bounce for half done and a full one, and a ring bursting out, once done;
 * cleared, the fill slides back off to the top left.
 */
export function HabitCheck({ mark, color, onCycle, label, className, buttonClassName, checkClassName, style, testId }: {
  mark: 0 | 1 | 2; color: string; onCycle: () => void; label: string;
  /** The circle's size and place; `buttonClassName` its border. */
  className?: string; buttonClassName?: string; checkClassName?: string; style?: CSSProperties; testId?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  return (
    <span className={cn("relative inline-grid shrink-0", className)}>
      <button ref={ref} type="button"
        onClick={(e) => {
          e.stopPropagation();
          const next = (mark + 1) % 3;
          if (next) void bounce(ref.current, next === 1 ? 0.5 : 1);
          if (next === 2) burst(ref.current, color);
          // Clearing goes back the way it came: along the diagonal, through half, to the top left.
          if (!next && !reduced()) fill.current?.animate([{ clipPath: FILL[2] }, { clipPath: FILL[1] }, { clipPath: FILL[0] }], { duration: 380, easing: "ease-in-out" });
          onCycle();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn("relative grid h-full w-full place-items-center overflow-hidden rounded-full transition-colors", buttonClassName)}
        // Its own layer throughout, so it doesn't flicker as a bounce ends and it's drawn again.
        style={{ borderColor: color, willChange: "transform", ...style }}
        aria-label={label} data-testid={testId}>
        <span ref={fill} className="absolute inset-0" aria-hidden
          style={{ background: color, clipPath: FILL[mark], transition: mark ? "clip-path .4s cubic-bezier(.2,.8,.3,1)" : "none" }} />
        <DrawnCheck on={mark === 2} className={checkClassName} />
      </button>
    </span>
  );
}

/** A streak count whose flame flares, and whose number rolls up, when it goes up by a day. */
export function useStreakFlare(streak: number) {
  const flame = useRef<SVGSVGElement>(null);
  const last = useRef(streak);
  const [rolled, setRolled] = useState(0);
  useEffect(() => {
    const up = streak > last.current;
    last.current = streak;
    if (!up || reduced()) return;
    setRolled((n) => n + 1);
    // Transforms only (a glow filter stutters on phones), so it plays right as the tap lands.
    flame.current?.animate([
      { transform: "scale(1) rotate(0)" },
      { transform: "scale(1.7) rotate(-10deg)", offset: 0.3 },
      { transform: "scale(1.15) rotate(6deg)", offset: 0.65 },
      { transform: "scale(1) rotate(0)" },
    ], { duration: 460, easing: "ease-out" });
  }, [streak]);
  return { flame, rolled };
}
