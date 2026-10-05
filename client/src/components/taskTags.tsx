import { useState } from "react";
import type { Item, Settings, TaskTag } from "@shared/schema";
import { useItemMutations, useItems, useSaveSettings, useSettings } from "@/lib/data";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { kindColorOf, kindOf, listOf } from "@/lib/cal";
import { Check, Hash, Pencil, Plus, Trash2, X } from "lucide-react";

/**
 * Task tags, like the journal's, but each has a color (kept in Settings.taskTags). A task's first
 * tag colors its checkbox, and in calendar views its left edge, while its tint stays task yellow.
 */
// Task yellow first (the default), then colors kept clear of the event blue, meeting purple, habit
// green and focus pink. The sleep indigo is fine to reuse: routine colors can be changed.
export const TAG_COLORS = ["#c9910d", "#e0701f", "#d93b3b", "#7a9a1f", "#11998e", "#3f51b5", "#b83fb8", "#8a6d3b", "#6b7280"];

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

/**
 * The bar down an item's left edge in calendar views: always its kind's color (task yellow, event blue...),
 * while the item itself takes its own color (a task's tag, or the color picked for it; see colorOf).
 */
export const accentOf = (i: Item, _settings?: Settings) => kindColorOf(i);

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

/**
 * A task's tag and the "add tag" button, which opens the task tags window to pick one (or make a new
 * one). A task has one tag (it gives the task its one color), so picking another replaces it.
 */
export function TaskTagField({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const { settings } = useSettings();
  const all = settings.taskTags ?? [];
  const chosen = value.slice(0, 1).map((n) => all.find((t) => t.name === n)).filter((t): t is TaskTag => !!t);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chosen.map((t) => (
        <TagChip key={t.name} tag={t} onRemove={() => onChange(value.filter((n) => n !== t.name))} />
      ))}
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary" data-testid="button-add-task-tag">
        <Plus className="h-3.5 w-3.5" />
        {chosen.length ? "change tag" : "add tag"}
      </button>
      <TagManager open={open} onOpenChange={setOpen} picked={chosen[0]?.name}
        onPick={(name) => { onChange([name]); setOpen(false); }} />
    </div>
  );
}

/** "add tag" in the tag manager: name a tag and pick its color. */
function NewTagForm({ taken, onCreate }: { taken: TaskTag[]; onCreate: (t: TaskTag) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);
  const typed = cleanTag(name);
  const exists = taken.some((t) => t.name === typed);
  const create = () => {
    if (!typed || exists) return;
    onCreate({ name: typed, color });
    setName("");
    setColor(TAG_COLORS[0]);
    setAdding(false);
  };
  if (!adding) {
    return (
      <button type="button" onClick={() => setAdding(true)} className="inline-flex h-7 w-fit items-center gap-1 rounded-full border border-dashed px-2.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary" data-testid="button-new-task-tag">
        <Plus className="h-3.5 w-3.5" />
        add tag
      </button>
    );
  }
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Tag name" className="h-9" aria-label="New tag name" data-testid="input-new-task-tag" />
        <Button size="sm" onClick={create} disabled={!typed || exists} data-testid="button-save-new-task-tag">Add</Button>
      </div>
      {exists && <p className="text-xs text-muted-foreground">#{typed} already exists.</p>}
      <ColorSwatches value={color} onChange={setColor} />
    </div>
  );
}

/**
 * The task tags list: add, rename, recolor or delete tags. Renaming or deleting also updates the tasks
 * that carry the tag. With onPick (the item editor), tapping a tag picks it and a new tag is picked
 * once it's made; the pencil edits it instead.
 */
export function TaskTagList({ onPick, picked, onRenamed, countOf, confirmDelete }: {
  onPick?: (name: string) => void; picked?: string; onRenamed?: (from: string, to: string) => void;
  /** The count beside each tag; tasks by default. */
  countOf?: (name: string) => string;
  /** Ask before deleting a tag (the journal, where it isn't obvious the tag leaves tasks too). */
  confirmDelete?: boolean;
}) {
  const { settings } = useSettings();
  const { data: items } = useItems();
  const save = useSaveSettings();
  const tags = settings.taskTags ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<TaskTag | null>(null);
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
  const edit = (t: TaskTag) => { setEditing(editing === t.name ? null : t.name); setName(t.name); };
  const tasks = (n: string) => {
    const count = (items ?? []).filter((i) => taskTagsOf(i).includes(n)).length;
    return `${count} ${count === 1 ? "task" : "tasks"}`;
  };
  return (
    <>
      <NewTagForm taken={tags} onCreate={(t) => { save.mutate({ taskTags: [...tags, t] }); onPick?.(t.name); }} />
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tags yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1">
          {tags.map((t) => (
            <li key={t.name} className="grid gap-2 py-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <button type="button" onClick={() => (onPick ? onPick(t.name) : edit(t))}
                  aria-expanded={onPick ? undefined : editing === t.name} aria-pressed={onPick ? picked === t.name : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  data-testid={onPick ? `option-task-tag-${t.name}` : `button-edit-task-tag-${t.name}`}>
                  <TagChip tag={t} />
                  {onPick && picked === t.name && <Check className="h-4 w-4 text-primary" aria-label="Picked" />}
                </button>
                <span className="text-xs text-muted-foreground tnum">{(countOf ?? tasks)(t.name)}</span>
                {onPick && (
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Edit tag ${t.name}`} aria-expanded={editing === t.name}
                    onClick={() => edit(t)} data-testid={`button-edit-task-tag-${t.name}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Delete tag ${t.name}`} onClick={() => (confirmDelete ? setDeleting(t) : remove(t))} data-testid={`button-delete-task-tag-${t.name}`}>
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
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent hideClose className="max-w-sm" data-testid="dialog-confirm-delete-task-tag">
          <DialogTitle className="text-[15px] font-normal leading-relaxed tracking-normal">Are you sure? This will delete this tag everywhere!</DialogTitle>
          <DialogDescription className="sr-only">Deletes #{deleting?.name} from every task and entry</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleting(null)} data-testid="button-cancel-delete-task-tag">Cancel</Button>
            <Button variant="destructive" size="sm" data-testid="button-confirm-delete-task-tag" onClick={() => {
              if (deleting) void remove(deleting);
              setDeleting(null);
            }}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The task tags window, from the Tasks page's Manage button and the item editor's add tag button. */
export function TagManager({ open, onOpenChange, onRenamed, onPick, picked }: {
  open: boolean; onOpenChange: (o: boolean) => void; onRenamed?: (from: string, to: string) => void;
  onPick?: (name: string) => void; picked?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto" data-testid="dialog-manage-tags">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>Task tags</DialogTitle>
          <DialogDescription className="sr-only">
            {onPick ? "Pick a tag for this task, or add a new one." : "Add, rename, recolor or delete task tags"}
          </DialogDescription>
        </DialogHeader>
        {/* Remounted when opened, so no tag is left open for editing. */}
        {open && <TaskTagList onPick={onPick} picked={picked} onRenamed={onRenamed} />}
      </DialogContent>
    </Dialog>
  );
}
