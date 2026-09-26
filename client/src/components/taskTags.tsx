import { useState } from "react";
import type { Item, Settings, TaskTag } from "@shared/schema";
import { useItemMutations, useItems, useSaveSettings, useSettings } from "@/lib/data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { colorOf, kindOf, listOf } from "@/lib/cal";
import { Check, Hash, Plus, Trash2, X } from "lucide-react";

/**
 * Task tags, like the journal's, but each has a color (kept in Settings.taskTags). A task's first
 * tag colors its checkbox, and in calendar views its left edge, while its tint stays task yellow.
 */
// Task yellow first (the default), then colors kept clear of the event blue, meeting purple, habit
// green and focus pink. The sleep indigo is fine to reuse: routine colors can be changed.
const TAG_COLORS = ["#c9910d", "#e0701f", "#d93b3b", "#7a9a1f", "#11998e", "#3f51b5", "#b83fb8", "#8a6d3b", "#6b7280"];

export const taskTagsOf = (i: Pick<Item, "tags">): string[] => listOf(i.tags).filter((x) => typeof x === "string");

// Tag lookups by name, built once per Settings.taskTags list.
const tagMaps = new WeakMap<TaskTag[], Map<string, TaskTag>>();
const tagsByName = (settings: Settings) => {
  const list = settings.taskTags ?? [];
  let m = tagMaps.get(list);
  if (!m) tagMaps.set(list, (m = new Map(list.map((t) => [t.name, t]))));
  return m;
};

/** The tags of a task that still exist in Settings, with their colors. */
export function itemTags(i: Pick<Item, "tags">, settings: Settings): TaskTag[] {
  const byName = tagsByName(settings);
  return taskTagsOf(i).map((n) => byName.get(n)).filter((t): t is TaskTag => !!t);
}

/** A task's first tag color, if it has one. */
export const firstTagColor = (i: Item, settings: Settings): string | undefined =>
  kindOf(i) === "task" ? itemTags(i, settings)[0]?.color : undefined;

/** An item's accent (checkbox and left edge) in calendar views: a tagged task's tag color, otherwise its usual color. */
export const accentOf = (i: Item, settings: Settings) => firstTagColor(i, settings) ?? colorOf(i);

/** A task's checkbox color in lists: its first tag's color, or the task yellow. */
export const taskColor = (i: Item, settings: Settings) => firstTagColor(i, settings) ?? "hsl(var(--k-task))";

/** A tag name as typed, cleaned up: lowercase, no #, dashes for spaces. Shared with journal tags. */
export const cleanTag = (t: string) => t.trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 32);

/** A tag chip's tinted background and text in the tag's color. */
export const tagTint = (color: string) => ({
  background: `color-mix(in srgb, ${color} 18%, transparent)`,
  color: `color-mix(in srgb, ${color} 75%, hsl(var(--foreground)))`,
});

export function TagChip({ tag, onRemove }: { tag: TaskTag; onRemove?: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-0.5 rounded-full px-2 text-xs font-medium"
      style={tagTint(tag.color)} data-testid={`chip-task-tag-${tag.name}`}>
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

/** The color choices for task tags and routines. */
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

/** Rename, recolor or delete task tags. Renaming or deleting also updates the tasks that carry the tag. */
export function TagManager({ open, onOpenChange, onRenamed }: { open: boolean; onOpenChange: (o: boolean) => void; onRenamed?: (from: string, to: string) => void }) {
  const { settings } = useSettings();
  const { data: items } = useItems();
  const save = useSaveSettings();
  const tags = settings.taskTags ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const { retag: retagItems } = useItemMutations();
  const retag = (from: string, to: string | null) => retagItems.mutateAsync({ from, to });
  const rename = async (tag: TaskTag) => {
    const to = cleanTag(name);
    setEditing(null);
    if (!to || to === tag.name) return;
    if (tags.some((t) => t.name === to)) {
      // Renaming onto an existing tag merges them.
      save.mutate({ taskTags: tags.filter((t) => t.name !== tag.name) });
    } else save.mutate({ taskTags: tags.map((t) => (t.name === tag.name ? { ...t, name: to } : t)) });
    onRenamed?.(tag.name, to);
    await retag(tag.name, to);
  };
  const remove = async (tag: TaskTag) => {
    save.mutate({ taskTags: tags.filter((t) => t.name !== tag.name) });
    await retag(tag.name, null);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setEditing(null); }}>
      <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto" data-testid="dialog-manage-tags">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>Task tags</DialogTitle>
          <DialogDescription>Tap a tag to rename it or change its color.</DialogDescription>
        </DialogHeader>
        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tags yet. Use “add tag” in a task's window.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-1">
            {tags.map((t) => (
              <li key={t.name} className="grid gap-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <button type="button" onClick={() => { setEditing(editing === t.name ? null : t.name); setName(t.name); }}
                    aria-expanded={editing === t.name} className="flex min-w-0 flex-1 items-center text-left" data-testid={`button-edit-task-tag-${t.name}`}>
                    <TagChip tag={t} />
                  </button>
                  <span className="text-xs text-muted-foreground tnum">{(items ?? []).filter((i) => taskTagsOf(i).includes(t.name)).length} tasks</span>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Delete tag ${t.name}`} onClick={() => remove(t)} data-testid={`button-delete-task-tag-${t.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {editing === t.name && (
                  <div className="grid gap-2 pl-1">
                    <div className="flex items-center gap-2">
                      <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && rename(t)}
                        className="h-9" aria-label="Tag name" data-testid="input-rename-task-tag" />
                      <Button size="sm" variant="outline" onClick={() => rename(t)} data-testid="button-rename-task-tag">Save</Button>
                    </div>
                    <ColorSwatches value={t.color} onChange={(color) => save.mutate({ taskTags: tags.map((x) => (x.name === t.name ? { ...x, color } : x)) })} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
