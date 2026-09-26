import { useState } from "react";
import type { Item, Settings, TaskTag } from "@shared/schema";
import { useSaveSettings, useSettings } from "@/lib/data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, Hash, Plus, X } from "lucide-react";

/**
 * Task tags, like the journal's, but each has a color (kept in Settings.taskTags). A task's first
 * tag colors its checkbox in lists; calendar views keep the task yellow.
 */
export const TAG_COLORS = ["#e66000", "#d93b3b", "#d8457a", "#8a4fd8", "#4f6bd8", "#0b8a9a", "#32855c", "#8a6d3b", "#6b7280"];

export function taskTagsOf(i: Pick<Item, "tags">): string[] {
  try {
    const t = JSON.parse(i.tags || "[]");
    return Array.isArray(t) ? t.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The tags of a task that still exist in Settings, with their colors. */
export function itemTags(i: Pick<Item, "tags">, settings: Settings): TaskTag[] {
  const byName = new Map((settings.taskTags ?? []).map((t) => [t.name, t]));
  return taskTagsOf(i).map((n) => byName.get(n)).filter((t): t is TaskTag => !!t);
}

/** A task's checkbox color: its first tag's color, or the task yellow. */
export function taskColor(i: Pick<Item, "tags">, settings: Settings): string {
  return itemTags(i, settings)[0]?.color ?? "hsl(var(--k-task))";
}

const cleanTag = (t: string) => t.trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 32);

export function TagChip({ tag, onRemove }: { tag: TaskTag; onRemove?: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-0.5 rounded-full px-2 text-xs font-medium"
      style={{ background: `color-mix(in srgb, ${tag.color} 18%, transparent)`, color: `color-mix(in srgb, ${tag.color} 75%, hsl(var(--foreground)))` }}
      data-testid={`chip-task-tag-${tag.name}`}>
      <Hash className="h-3 w-3" />
      {tag.name}
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 -mr-1 grid h-4 w-4 place-items-center rounded-full hover:bg-black/10" aria-label={`Remove tag ${tag.name}`}>
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tag color">
      {TAG_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} onClick={() => onChange(c)}
          className={cn("grid h-6 w-6 place-items-center rounded-full", value === c && "ring-2 ring-offset-2 ring-offset-popover ring-foreground/60")}
          style={{ background: c }} data-testid={`swatch-${c.slice(1)}`}>
          {value === c && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

/** Chips for a task's tags plus the "add tag" button: pick a tag, or name a new one and choose its color. */
export function TaskTagField({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const { settings } = useSettings();
  const save = useSaveSettings();
  const all = settings.taskTags ?? [];
  const chosen = value.map((n) => all.find((t) => t.name === n)).filter((t): t is TaskTag => !!t);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);
  const typed = cleanTag(q);
  const options = all.filter((t) => !value.includes(t.name) && (!typed || t.name.includes(typed)));
  const exists = all.some((t) => t.name === typed);
  const pick = (name: string) => {
    onChange([...value, name]);
    setQ("");
    setOpen(false);
  };
  const create = () => {
    if (!typed || exists) return;
    save.mutate({ taskTags: [...all, { name: typed, color }] });
    pick(typed);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chosen.map((t) => (
        <TagChip key={t.name} tag={t} onRemove={() => onChange(value.filter((n) => n !== t.name))} />
      ))}
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary" data-testid="button-add-task-tag">
            <Plus className="h-3.5 w-3.5" />
            add tag
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 rounded p-0 shadow-lg">
          <div className="flex items-center gap-1.5 border-b px-3">
            <Hash className="h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (typed && !exists) create();
                else if (options[0]) pick(options[0].name);
              }}
              placeholder="Type a tag" className="h-10 flex-1 bg-transparent text-sm outline-none" aria-label="Tag name" data-testid="input-task-tag" />
          </div>
          {typed && !exists && (
            <div className="grid gap-2 border-b px-3 py-2.5">
              <ColorSwatches value={color} onChange={setColor} />
              <button type="button" onClick={create} className="flex items-center gap-2 text-left text-sm" data-testid="button-create-task-tag">
                <Plus className="h-3.5 w-3.5 text-primary" />
                Create <TagChip tag={{ name: typed, color }} />
              </button>
            </div>
          )}
          <div className="max-h-56 overflow-y-auto py-1" role="listbox" aria-label="Tags">
            {options.length === 0 && !typed ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">{all.length ? "No more tags" : "Type a name to make your first tag"}</div>
            ) : (
              options.map((t) => (
                <button key={t.name} type="button" role="option" onClick={() => pick(t.name)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted" data-testid={`option-task-tag-${t.name}`}>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.color }} />
                  #{t.name}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
