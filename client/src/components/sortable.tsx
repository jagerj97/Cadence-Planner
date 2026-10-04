import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

const HOLD_MS = 500; // Android's long press; a finger resting briefly before a scroll still scrolls
const SLOP_PX = 8; // moving farther than this before the hold completes means the user is scrolling

type Drag = { index: number; startY: number; dy: number; over: number; mids: number[]; step: number };

/**
 * A list reordered by touch: hold an item until it lifts (it grows slightly), drag it into place, and
 * let go to drop it. A quick swipe still scrolls the page, and taps reach the item as usual. The list
 * runs down the page, or across it with `horizontal` (a row like the bottom bar).
 */
export function SortableList<T extends string | number>({ items, onReorder, render, className, itemClassName, as = "div", horizontal = false }: {
  items: T[];
  onReorder: (next: T[]) => void;
  render: (item: T, lifted: boolean) => ReactNode;
  className?: string;
  itemClassName?: string;
  as?: "div" | "ul";
  horizontal?: boolean;
}) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pending = useRef<{ index: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const suppressClick = useRef(false);

  const update = (next: Drag | null) => { dragRef.current = next; setDrag(next); };
  const clearPending = () => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  };

  // While an item is lifted, stop the page from scrolling under the finger.
  useEffect(() => {
    if (!drag) return;
    const block = (event: TouchEvent) => event.preventDefault();
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, [!!drag]); // eslint-disable-line react-hooks/exhaustive-deps

  const lift = (index: number, y: number) => {
    const rects = refs.current.map((el) => el?.getBoundingClientRect());
    const self = rects[index];
    if (!self) return;
    const next = rects[index + 1] ?? rects[index - 1];
    const [start, end, size] = horizontal ? (["left", "right", "width"] as const) : (["top", "bottom", "height"] as const);
    const gap = next ? Math.abs((index + 1 < rects.length ? next[start] - self[end] : self[start] - next[end])) : 0;
    haptic("hold");
    update({ index, startY: y, dy: 0, over: index, mids: rects.map((r) => (r ? r[start] + r[size] / 2 : 0)), step: self[size] + gap });
  };

  const onPointerDown = (index: number) => (event: React.PointerEvent) => {
    if (event.button !== 0 || dragRef.current) return;
    clearPending();
    const { clientX: x, clientY: y } = event;
    pending.current = { index, x, y, timer: setTimeout(() => { pending.current = null; lift(index, horizontal ? x : y); }, HOLD_MS) };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const p = pending.current;
    if (p && Math.hypot(event.clientX - p.x, event.clientY - p.y) > SLOP_PX) clearPending();
    const d = dragRef.current;
    if (!d) return;
    // Distance along the list (down it, or across it when horizontal); startY holds the start either way.
    const dy = (horizontal ? event.clientX : event.clientY) - d.startY;
    const center = d.mids[d.index] + dy;
    let over = d.index;
    while (over < d.mids.length - 1 && center > d.mids[over + 1]) over++;
    while (over > 0 && center < d.mids[over - 1]) over--;
    if (over !== d.over) haptic("tick");
    update({ ...d, dy, over });
  };
  const finish = (commit: boolean) => {
    clearPending();
    const d = dragRef.current;
    if (!d) return;
    update(null);
    suppressClick.current = true; // the release after a drag isn't a tap
    setTimeout(() => { suppressClick.current = false; }, 0);
    if (commit && d.over !== d.index) {
      const next = [...items];
      const [moved] = next.splice(d.index, 1);
      next.splice(d.over, 0, moved);
      onReorder(next);
    }
  };

  const shift = (index: number) => {
    if (!drag || index === drag.index) return 0;
    if (drag.index < drag.over && index > drag.index && index <= drag.over) return -drag.step;
    if (drag.index > drag.over && index < drag.index && index >= drag.over) return drag.step;
    return 0;
  };

  const Container = as;
  const Item = as === "ul" ? "li" : "div";
  return (
    <Container className={className}>
      {items.map((item, index) => {
        const lifted = drag?.index === index;
        return (
          <Item
            key={item}
            ref={(el: HTMLElement | null) => { refs.current[index] = el; }}
            onPointerDown={onPointerDown(index)}
            onPointerMove={onPointerMove}
            onPointerUp={() => finish(true)}
            onPointerCancel={() => finish(false)}
            onContextMenu={(event: React.MouseEvent) => event.preventDefault()}
            onClickCapture={(event: React.MouseEvent) => { if (suppressClick.current) { event.stopPropagation(); event.preventDefault(); } }}
            className={cn(
              "relative select-none",
              lifted ? "z-20 rounded-xl bg-card shadow-lg" : drag ? "transition-transform duration-150" : "",
              itemClassName,
            )}
            style={{ transform: lifted ? `${horizontal ? "translateX" : "translateY"}(${drag!.dy}px) scale(1.04)` : `${horizontal ? "translateX" : "translateY"}(${shift(index)}px)`, WebkitTouchCallout: "none" }}
            data-sortable-lifted={lifted || undefined}
          >
            {render(item, lifted)}
          </Item>
        );
      })}
    </Container>
  );
}
