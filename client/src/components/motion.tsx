import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Whether the device asks for less motion: every animation here (and in pageTurn) is skipped then. */
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A quick squeeze and spring back, `big` from 0 (none) to 1 (a full bounce): a box checked, a circle filled. */
export function bounce(el: Element | null, big = 1) {
  if (!el || reducedMotion()) return Promise.resolve();
  return el.animate([
    { transform: "scale(1)" }, { transform: `scale(${1 - 0.22 * big})`, offset: 0.25 },
    { transform: `scale(${1 + 0.18 * big})`, offset: 0.6 }, { transform: "scale(.97)", offset: 0.82 }, { transform: "scale(1)" },
  ], { duration: 420, easing: "ease-out" }).finished.then(() => {}, () => {});
}

/** A soft swell out to `to` and back: something finished (the focus timer). */
export function pulse(el: Element | null, to = 1.04, ms = 520) {
  if (!el || reducedMotion()) return;
  el.animate([{ transform: "scale(1)" }, { transform: `scale(${to})`, offset: 0.35 }, { transform: "scale(1)" }], { duration: ms, easing: "ease-out" });
}

/** False on the first frame, then true: for things that grow in from nothing when they first show. */
export function useShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const f = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(f);
  }, []);
  return shown || reducedMotion();
}

/**
 * A number that glides to its new value over `ms` when it jumps by more than `step` (a timer
 * resetting, a total changing) rather than snapping; smaller changes (a clock ticking) are immediate.
 * With `fromZero`, it counts up from 0 when it first shows.
 */
export function useGlide(value: number, step = 0, ms = 500, fromZero = false) {
  const [shown, setShown] = useState(fromZero && !reducedMotion() ? 0 : value);
  const from = useRef(shown);
  useEffect(() => {
    const start = from.current;
    if (Math.abs(value - start) <= step || reducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms), eased = 1 - Math.pow(1 - p, 3);
      from.current = start + (value - start) * eased;
      setShown(from.current);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, step, ms]);
  return shown;
}

/**
 * A ring that bursts out from `el` and fades (laid over it, in its parent): for something finished.
 * `width` is the ring's line, `to` how far it grows.
 */
export function burst(el: HTMLElement | null, color: string, width = 2, to = 2.3) {
  if (!el || reducedMotion()) return;
  const ring = document.createElement("span");
  Object.assign(ring.style, {
    position: "absolute", left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, width: `${el.offsetWidth}px`,
    height: `${el.offsetHeight}px`, borderRadius: "50%", border: `${width}px solid ${color}`, pointerEvents: "none",
  });
  el.parentElement?.appendChild(ring);
  ring.animate([{ transform: "scale(1)", opacity: 0.7 }, { transform: `scale(${to})`, opacity: 0 }], { duration: 520 + 200 * (to - 2), easing: "ease-out" })
    .finished.finally(() => ring.remove());
}

/**
 * Content that changes smoothly: when `k` changes, the old content fades out as the new fades in, and
 * the box eases to the new content's height instead of jumping (to nothing, when there's none).
 */
export function Morph({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [prev, setPrev] = useState<{ k: string; node: ReactNode } | null>(null);
  const last = useRef({ k, node: children });
  useLayoutEffect(() => {
    if (last.current.k !== k && !reducedMotion()) setPrev(last.current);
    last.current = { k, node: children };
  });
  useEffect(() => {
    if (!prev) return;
    const t = setTimeout(() => setPrev(null), 260);
    return () => clearTimeout(t);
  }, [prev]);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={cn("relative overflow-hidden transition-[height] duration-300 ease-out motion-reduce:transition-none", className)}
      style={{ height: height ?? undefined }}>
      <div ref={inner} className="flow-root">
        <div key={k} className={cn(prev && "animate-in fade-in slide-in-from-bottom-1 duration-300")}>{children}</div>
      </div>
      {prev && (
        <div key={`was-${prev.k}`} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 animate-out fade-out slide-out-to-top-1 duration-200 fill-mode-forwards">
          {prev.node}
        </div>
      )}
    </div>
  );
}

/**
 * A highlight that slides, with a little bounce, to whichever tab in `ref`'s element is selected
 * (aria-selected), instead of jumping there. Draw it with <SlidePill>; the tabs sit above it.
 */
export function useSlidePill<T extends HTMLElement>(selected: unknown) {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const on = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (on) setBox({ x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selected]);
  return [ref, box] as const;
}

export function SlidePill({ box, className }: { box: { x: number; y: number; w: number; h: number } | null; className?: string }) {
  if (!box) return null;
  return (
    <span aria-hidden className={cn("pointer-events-none absolute transition-[left,top,width,height] duration-300 motion-reduce:transition-none", className)}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, transitionTimingFunction: "cubic-bezier(.3,1.3,.5,1)" }} />
  );
}
