import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A wrapping row of chips (tags) kept to two rows: when they'd run onto a third, the ones that don't
 * fit are hidden and a "more" chip at the end shows them all ("less" folds them away again).
 * Chips are hidden from the end, so leading controls (Manage, add tag) always stay in view.
 */
export function TwoRows({ children, className, chipClassName, testId, ...rest }: {
  children: ReactNode;
  className?: string;
  /** Sizes the more / less chip to match the chips in the list. */
  chipClassName?: string;
  testId?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  const ref = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // Measured after every render and whenever the list changes width, before the browser paints.
  const fit = () => {
    const box = ref.current, button = more.current;
    if (!box || !button) return;
    const chips = [...box.children].filter((el): el is HTMLElement => el !== button && el instanceof HTMLElement);
    for (const chip of chips) chip.style.display = "";
    button.style.display = "none";
    const rows = [...new Set(chips.map((chip) => chip.offsetTop))].sort((a, b) => a - b);
    if (rows.length <= 2) return;
    button.style.display = "";
    if (open) return;
    // Hide everything past the second row, then step back until "more" fits on the second row too.
    const second = rows[1];
    let shown = chips.findIndex((chip) => chip.offsetTop > second);
    for (let k = shown; k < chips.length; k++) chips[k].style.display = "none";
    while (shown > 1 && button.offsetTop > second) chips[--shown].style.display = "none";
  };
  useLayoutEffect(fit);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    let width = box.clientWidth;
    const watch = new ResizeObserver(() => {
      if (box.clientWidth !== width) { width = box.clientWidth; fit(); }
    });
    watch.observe(box);
    return () => watch.disconnect();
  });

  return (
    <div ref={ref} className={cn("flex flex-wrap", className)} data-testid={testId} {...rest}>
      {children}
      <button ref={more} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ display: "none" }}
        className={cn("inline-flex h-7 shrink-0 items-center rounded-full border border-dashed px-2.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary", chipClassName)}
        data-testid={testId ? `${testId}-more` : "button-tags-more"}>
        {open ? "less" : "more"}
      </button>
    </div>
  );
}
