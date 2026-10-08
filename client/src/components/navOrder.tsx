import { SortableList } from "@/components/sortable";
import { orderNav } from "@/components/shell";
import { cn } from "@/lib/utils";
import { GripHorizontal } from "lucide-react";

/**
 * The bottom bar's pages drawn like the bar itself, to reorder: hold one and drag it along. Used in
 * Today's Customize window and in Settings → Appearance. The app still opens on Today, wherever it sits.
 */
export function NavOrderEditor({ order, onReorder }: { order: string[] | undefined; onReorder: (next: string[]) => void }) {
  const pages = orderNav(order);
  return (
    <SortableList
      horizontal
      items={pages.map((n) => n.href)}
      onReorder={onReorder}
      className="flex rounded-[20px] border bg-muted/40 p-0.5"
      itemClassName="min-w-0 flex-1"
      render={(href, lifted) => {
        const n = pages.find((page) => page.href === href)!;
        return (
          <div className={cn("flex flex-col items-center gap-0.5 rounded-2xl pb-1 pt-2 text-muted-foreground", lifted && "text-primary")}
            data-testid={`row-nav-${n.label.toLowerCase()}`}>
            <n.icon className="h-5 w-5" aria-hidden />
            <span className="max-w-full truncate text-[10px] tracking-tight">{n.label}</span>
            {/* Grip dots: each page can be held and dragged along. */}
            <GripHorizontal className="h-3 w-3 opacity-60" aria-hidden />
          </div>
        );
      }}
    />
  );
}
