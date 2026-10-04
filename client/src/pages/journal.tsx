import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { KIND_TAGS, canonicalTag, tagSpellings, type Item, type JournalEntry, type Kind, type Settings } from "@shared/schema";
import { PageHeader } from "@/components/shell";
import { hashtagsIn, tagsOf, useItems, useJournal, useJournalMutations, useSettings } from "@/lib/data";
import { DAY_SHORT, KIND_META, addDays, colorOf, fmtDate, kindOf, parseYmd, startOfWeek, todayStr, ymd } from "@/lib/cal";
import { DayPicker } from "@/pages/calendar";
import { usePlanner } from "@/components/planner";
import { TaskTagList, accentOf, cleanTag, itemTags, tagTint } from "@/components/taskTags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { TwoRows } from "@/components/twoRows";
import { Archive, ArchiveRestore, ChevronDown, ChevronLeft, ChevronRight, Hash, Settings2, NotebookPen, Plus, Search, Trash2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
/** When an entry was last edited: the time, with the date too if that wasn't the day it was written. */
const editedAt = (e: JournalEntry) => {
  const at = new Date(e.updatedAt);
  return at.toDateString() === new Date(e.createdAt).toDateString()
    ? timeOf(e.updatedAt)
    : `${at.toLocaleDateString([], { month: "short", day: "numeric" })}, ${timeOf(e.updatedAt)}`;
};

/**
 * A kind tag (#events, #tasks...) takes its item's color, or its kind's; a task tag takes its own
 * color; other tags keep the accent.
 */
const KIND_OF_TAG = new Map(Object.entries(KIND_TAGS).map(([k, t]) => [t, k as Kind]));
function tagColor(t: string, settings: Settings, item?: Item): string | undefined {
  const kind = KIND_OF_TAG.get(t);
  if (!kind) return settings.taskTags?.find((x) => x.name === t)?.color;
  return item && kindOf(item) === kind ? colorOf(item) : `hsl(var(${KIND_META[kind].cssVar}))`;
}

/**
 * An entry's tags, with its task's tag when it holds a tagged task's notes. The task tag is read from
 * the task, so changing, renaming or deleting it there shows here too.
 */
function entryTags(e: JournalEntry, item: Item | undefined, settings: Settings): string[] {
  const own = tagsOf(e);
  if (!item || kindOf(item) !== "task") return own;
  return [...new Set([...own, ...itemTags(item, settings).map((t) => t.name)])];
}
const tagStyle = (color?: string) => (color ? tagTint(color) : undefined);

/** Entries mark **bold**, *italic* and __underline__ in their text (the composer's format buttons add them). */
const FORMAT = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*[^*\n]+?\*)/;
/** onTag left out: #words are plain text (the entry has tags from its text turned off). */
function Rich({ text, onTag }: { text: string; onTag?: (t: string) => void }) {
  return (
    <>
      {text.split(FORMAT).map((part, i) => {
        if (i % 2 === 0) return <Tagged key={i} text={part} onTag={onTag} />;
        if (part.startsWith("**")) return <strong key={i} className="font-semibold"><Rich text={part.slice(2, -2)} onTag={onTag} /></strong>;
        if (part.startsWith("__")) return <u key={i}><Rich text={part.slice(2, -2)} onTag={onTag} /></u>;
        return <em key={i}><Rich text={part.slice(1, -1)} onTag={onTag} /></em>;
      })}
    </>
  );
}

/** body text with formatting, and #hashtags highlighted and clickable */
function Body({ text, onTag }: { text: string; onTag?: (t: string) => void }) {
  return (
    <p className="text-[16px] leading-relaxed whitespace-pre-wrap break-words">
      <Rich text={text} onTag={onTag} />
    </p>
  );
}

function Tagged({ text, onTag }: { text: string; onTag?: (t: string) => void }) {
  if (!onTag) return <span>{text}</span>;
  const parts = text.split(/((?:^|\s)#[\p{L}\p{N}_-]+)/gu);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^(\s?)#([\p{L}\p{N}_-]+)$/u);
        if (!m) return <span key={i}>{p}</span>;
        return (
          <span key={i}>
            {m[1]}
            <button onClick={() => onTag(canonicalTag(m[2].toLowerCase()))} className="text-primary font-medium hover:underline">
              #{m[2]}
            </button>
          </span>
        );
      })}
    </>
  );
}

function TagChips({ tags, onRemove, onClick, item }: { tags: string[]; onRemove?: (t: string) => void; onClick?: (t: string) => void; item?: Item }) {
  const { settings } = useSettings();
  if (!tags.length) return null;
  return (
    <TwoRows className="gap-1.5" chipClassName="h-6">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-0.5 rounded-full bg-accent text-accent-foreground pl-2 pr-2 h-6 text-xs font-medium" style={tagStyle(tagColor(t, settings, item))}>
          <button onClick={() => onClick?.(t)} className={cn("inline-flex items-center", !onClick && "cursor-default")} data-testid={`chip-tag-${t}`}>
            <Hash className="h-3 w-3" />
            {t}
          </button>
          {onRemove && (
            <button onClick={() => onRemove(t)} className="ml-0.5 -mr-1 grid h-4 w-4 place-items-center rounded-full hover:bg-black/10" aria-label={`Remove tag ${t}`}>
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
    </TwoRows>
  );
}

const SUGGESTED = ["idea", "gratitude", "health", "sleep", "work", "mood", "win", "todo", "family", "learning"];

/** "add tag" button → type a new tag or pick from suggestions */
function TagPicker({ taken, hide, onAdd }: { taken: string[]; hide?: (t: string) => boolean; onAdd: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: entries } = useJournal();
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries ?? []) if (!e.archived) for (const t of tagsOf(e)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [entries]);
  const typed = canonicalTag(cleanTag(q));
  const pool = [...new Set([...[...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b)), ...SUGGESTED])];
  const options = pool.filter((t) => !taken.includes(t) && !hide?.(t) && (!typed || t.includes(typed))).slice(0, 12);
  const add = (t: string) => {
    if (!t || hide?.(t)) return;
    onAdd(t);
    setQ("");
    // A kind tag asks whether to turn the entry into an item, so get out of the way.
    if (CONVERTIBLE.has(t)) setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 rounded-full border border-dashed h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary" data-testid="button-add-tag">
          <Plus className="h-3.5 w-3.5" />
          add tag
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 overflow-hidden p-0 shadow-lg">
        <div className="flex items-center gap-1.5 border-b px-3">
          <Hash className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(typed || options[0] || "");
              }
            }}
            placeholder="Type a tag"
            className="h-10 flex-1 bg-transparent text-sm outline-none"
            aria-label="Tag name"
            data-testid="input-journal-tag"
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1.5" role="listbox" aria-label="Tag suggestions">
          {typed && !pool.includes(typed) && !taken.includes(typed) && !hide?.(typed) && (
            <button onClick={() => add(typed)} className="flex h-9 w-full items-center gap-2 rounded-full px-3.5 text-sm font-medium hover:bg-muted text-left" data-testid="button-create-tag">
              <Plus className="h-3.5 w-3.5 text-primary" />
              Create <span className="font-medium text-primary">#{typed}</span>
            </button>
          )}
          {options.length === 0 && !typed ? (
            <div className="px-3.5 py-2 text-sm text-muted-foreground">No more suggestions</div>
          ) : (
            options.map((t) => (
              <button key={t} onClick={() => add(t)} className="flex h-9 w-full items-center justify-between rounded-full px-3.5 text-sm font-medium hover:bg-muted text-left" role="option" data-testid={`option-tag-${t}`}>
                <span>#{t}</span>
                <span className="text-xs text-muted-foreground tnum">{counts.get(t) ? `${counts.get(t)} used` : "suggested"}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const FORMATS = [
  { mark: "**", label: "Bold", letter: "B", style: "font-bold", find: /\*\*[^*\n]+?\*\*/g },
  { mark: "*", label: "Italic", letter: "I", style: "italic", find: /(?<!\*)\*[^*\n]+?\*(?!\*)/g },
  { mark: "__", label: "Underline", letter: "U", style: "underline underline-offset-2", find: /__[^_\n]+?__/g },
] as const;
type Format = (typeof FORMATS)[number];
/** Whether the text around a selection is a format's pair of marks. A lone * next to ** belongs to bold. */
const wrappedIn = (mark: string, before: string, after: string) =>
  before.endsWith(mark) && after.startsWith(mark) && (mark !== "*" || !before.endsWith("**") || before.endsWith("***"));
/** Whether the selection sits inside a format's marks (or right between an empty pair). */
function formatAt(f: Format, text: string, a: number, b: number) {
  const n = f.mark.length;
  if (wrappedIn(f.mark, text.slice(0, a), text.slice(b))) return true;
  for (const m of text.matchAll(f.find)) if (m.index! + n <= a && b <= m.index! + m[0].length - n) return true;
  return false;
}

/** Tags that turn an entry into a planner item of that kind, when picked (see Composer). */
const CONVERTIBLE = new Map((["task", "event", "meeting", "focus"] as Kind[]).map((k) => [KIND_TAGS[k], k]));
const KIND_NOUN: Partial<Record<Kind, string>> = { task: "a task", event: "an event", meeting: "a meeting", focus: "a focus session" };
export type ConvertTo = { kind: Kind; title: string; body: string; tags: string[] };

/**
 * The entry window's contents, for new and edited entries: a title, a note that grows with its text
 * (then scrolls once it fills the screen above the keyboard), tags, and format buttons along the bottom.
 * Picking a kind tag (#tasks, #events...) offers to turn the entry into that kind of item instead.
 */
/**
 * A round icon button that opens into a pill asking to confirm ("Delete?", "Archive?"); tapping the
 * pill does it. Tapping anywhere else closes it again.
 */
function ConfirmButton({ icon: Icon, label, ask, tone, onConfirm, testId }: {
  icon: typeof Trash2; label: string; ask: string; tone: "destructive" | "primary"; onConfirm: () => void; testId: string;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" onClick={() => (armed ? onConfirm() : setArmed(true))} onBlur={() => setArmed(false)}
      className={cn("mt-3 inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full text-xs font-medium transition-all duration-200",
        armed ? (tone === "destructive" ? "bg-destructive px-3 text-destructive-foreground" : "bg-primary px-3 text-primary-foreground")
          : cn("w-8 text-muted-foreground hover:bg-muted", tone === "destructive" ? "hover:text-destructive" : "hover:text-primary"))}
      aria-label={armed ? `${ask} Tap again to confirm` : label} data-testid={testId}>
      <Icon className="h-4 w-4" />
      {armed && <span>{ask}</span>}
    </button>
  );
}

function Composer({
  initialTitle = "",
  initial = "",
  initialTags = [],
  initialHashtags = true,
  submitLabel,
  onSubmit,
  onCancel,
  onConvert,
  saveRef,
  busy,
  onDelete,
  archived,
  onArchive,
}: {
  initialTitle?: string;
  initial?: string;
  initialTags?: string[];
  /** Whether #words in the text make tags ("Use tags in entry"). */
  initialHashtags?: boolean;
  submitLabel: string;
  onSubmit: (title: string, body: string, tags: string[], hashtags: boolean) => Promise<unknown> | void;
  onCancel?: () => void;
  onConvert: (to: ConvertTo) => void;
  /** Set to save (or, with nothing written, cancel): tapping outside the window does this. */
  saveRef?: React.MutableRefObject<(() => void) | null>;
  busy?: boolean;
  /** Deletes the entry being edited (not offered for a new one). */
  onDelete?: () => void;
  /** Whether the entry being edited is in the Archive. */
  archived?: boolean;
  /** Moves the entry being edited into the Archive, or back out, keeping what's been typed. */
  onArchive?: (title: string, body: string, tags: string[], hashtags: boolean) => void;
}) {
  const [sel, setSel] = useState<[number, number]>([initial.length, initial.length]);
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initial);
  const [useHashtags, setUseHashtags] = useState(initialHashtags);
  const [extra, setExtra] = useState<string[]>(initialTags.filter((t) => !(initialHashtags && hashtagsIn(initial).includes(t))));
  // The kind the entry would become, while the prompt is open; `typed` when it came from a #hashtag in the text.
  const [ask, setAsk] = useState<{ kind: Kind; typed: boolean } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Follow the selection so B, I and U show the format under it.
  useEffect(() => {
    const f = () => {
      const el = ref.current;
      if (el && document.activeElement === el) setSel((s) => (s[0] === el.selectionStart && s[1] === el.selectionEnd ? s : [el.selectionStart, el.selectionEnd]));
    };
    document.addEventListener("selectionchange", f);
    return () => document.removeEventListener("selectionchange", f);
  }, []);
  // The note is as tall as its text; the window's height limit (flex) makes it scroll past that.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);
  const inline = useHashtags ? hashtagsIn(body) : [];
  const all = [...new Set([...inline, ...extra])];
  // Kind tags newly typed into the text (ones an entry already had stay as they are).
  const typedKinds = inline.filter((t) => CONVERTIBLE.has(t) && !initialTags.includes(t));
  // Wraps the selection in a format's marks, or unwraps it if it already has them.
  const format = (mark: string) => {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    const before = body.slice(0, a), sel = body.slice(a, b), after = body.slice(b);
    const n = mark.length;
    const around = wrappedIn(mark, before, after);
    let next: string, s: number, e: number;
    if (around) [next, s, e] = [before.slice(0, -n) + sel + after.slice(n), a - n, b - n];
    else if (sel.length > 2 * n && sel.startsWith(mark) && sel.endsWith(mark)) [next, s, e] = [before + sel.slice(n, -n) + after, a, b - 2 * n];
    else [next, s, e] = [before + mark + sel + mark + after, a + n, b + n];
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s, e); setSel([s, e]); });
  };
  // `asked`: the kind tag prompt was answered No, so save with the tag as it is.
  const submit = async (asked = false) => {
    if (!body.trim()) return;
    if (!asked && typedKinds.length) {
      setAsk({ kind: CONVERTIBLE.get(typedKinds[0])!, typed: true });
      return;
    }
    await onSubmit(title, body, all, useHashtags);
  };
  if (saveRef) saveRef.current = () => (body.trim() ? void submit() : onCancel?.());
  const addTag = (tag: string) => {
    const t = canonicalTag(tag);
    if (all.includes(t)) return;
    const kind = CONVERTIBLE.get(t);
    if (kind) setAsk({ kind, typed: false });
    else setExtra((x) => [...x, t]);
  };
  // Other tags and at most one kind tag, which an item's entry gets from its kind.
  const hasKind = all.some((t) => KIND_OF_TAG.has(t));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-start gap-1 pr-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); ref.current?.focus(); }
        }}
        placeholder="Title"
        maxLength={200}
        className="min-w-0 flex-1 bg-transparent px-4 pt-4 text-[17px] font-semibold outline-none placeholder:font-medium placeholder:text-muted-foreground"
        aria-label="Title"
        data-testid="input-journal-title"
      />
      {onArchive && (archived
        ? <ConfirmButton icon={ArchiveRestore} label="Take out of the archive" ask="Unarchive?" tone="primary" testId="button-journal-archive"
            onConfirm={() => onArchive(title, body, all, useHashtags)} />
        : <ConfirmButton icon={Archive} label="Archive entry" ask="Archive?" tone="primary" testId="button-journal-archive"
            onConfirm={() => onArchive(title, body, all, useHashtags)} />)}
      {onDelete && <ConfirmButton icon={Trash2} label="Delete entry" ask="Delete?" tone="destructive" testId="button-journal-delete" onConfirm={onDelete} />}
      </div>
      <Textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder="Jot something down…"
        rows={4}
        className="min-h-[112px] shrink resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 py-0 text-[16px] leading-relaxed shadow-none scroll-thin focus-visible:ring-0 focus-visible:ring-offset-0"
        data-testid="input-journal-body"
      />
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-1">
        <TagChips tags={all} onRemove={(t) => (inline.includes(t)
          // Removing a tag from the text takes it out (either spelling, wherever it's written).
          ? setBody(body.replace(new RegExp(`(^|\\s)#(${tagSpellings(t).join("|")})(?![\\p{L}\\p{N}_-])`, "giu"), "$1"))
          : setExtra(extra.filter((x) => x !== t)))} />
        <TagPicker taken={all} hide={(t) => KIND_OF_TAG.has(t) && (hasKind || !CONVERTIBLE.has(t))} onAdd={addTag} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5 px-4 pb-4">
        {/* B, I and U buttons look like the add tag button, and take the tag color while the selection has that format. */}
        <div className="flex items-center gap-1.5" role="toolbar" aria-label="Text formatting">
          {FORMATS.map((f) => {
            const on = formatAt(f, body, sel[0], sel[1]);
            return (
              // pointerdown keeps the textarea's selection
              <button key={f.label} type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => format(f.mark)}
                className={cn("grid h-7 w-7 place-items-center rounded-full border text-sm transition-colors", f.style,
                  on ? "border-transparent bg-accent text-accent-foreground" : "border-dashed text-muted-foreground hover:border-primary hover:text-primary")}
                aria-label={f.label} aria-pressed={on} title={f.label} data-testid={`button-format-${f.label.toLowerCase()}`}>
                {f.letter}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel} data-testid="button-journal-cancel">
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={() => submit()} disabled={!body.trim() || busy} data-testid="button-journal-save">
            {submitLabel}
          </Button>
        </div>
      </div>
      <label className="-mt-2 flex w-fit shrink-0 cursor-pointer items-center gap-2 px-4 pb-4 text-xs text-muted-foreground">
        <input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" checked={useHashtags}
          onChange={(e) => setUseHashtags(e.target.checked)} data-testid="checkbox-journal-hashtags" />
        Use tags in entry
      </label>
      <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent hideClose className="max-w-sm" data-testid="dialog-journal-convert">
          <DialogTitle className="text-[15px] font-normal leading-relaxed tracking-normal">
            Would you like to make this entry into {ask ? KIND_NOUN[ask.kind] : ""}? This cannot be undone!
          </DialogTitle>
          <DialogDescription className="sr-only">Opens a new item with this entry's title and text as its notes</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" data-testid="button-convert-no" onClick={() => {
              const typed = ask?.typed;
              const kind = ask?.kind;
              setAsk(null);
              // No keeps the tag: one typed in the text saves with it, a picked one is added.
              if (typed) void submit(true);
              else if (kind) setExtra((x) => [...x, KIND_TAGS[kind]]);
            }}>No</Button>
            <Button size="sm" data-testid="button-convert-yes" onClick={() => {
              if (!ask) return;
              setAsk(null);
              onConvert({ kind: ask.kind, title: title.trim(), body: body.trim(), tags: all.filter((t) => !KIND_OF_TAG.has(t)) });
            }}>Yes</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EntryCard({ e, onTag, showDate, item, openDetails, onEdit }: {
  e: JournalEntry; onTag: (t: string) => void; showDate?: boolean; item?: Item; openDetails: (i: Item) => void; onEdit: (e: JournalEntry) => void;
}) {
  const { toast } = useToast();
  const { settings } = useSettings();
  const [, nav] = useLocation();
  const tags = entryTags(e, item, settings);
  const fromText = e.hashtags === false ? [] : hashtagsIn(e.body);
  const extraTags = tags.filter((t) => !fromText.includes(t));
  return (
    <article
      className="card-md p-4 group cursor-pointer"
      // Tapping an entry opens it to edit; one holding an item's notes opens that item. Its buttons, tags
      // and links keep their own taps.
      onClick={(ev) => !(ev.target as HTMLElement).closest("button, a, input, textarea") && (item ? openDetails(item) : onEdit(e))}
      data-testid={`card-entry-${e.id}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {showDate ? (
          <button onClick={() => nav(`/journal/${e.date}`)} className="font-medium text-foreground hover:text-primary">
            {fmtDate(e.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          </button>
        ) : null}
        <span className="tnum" data-testid={`text-entry-time-${e.id}`}>{timeOf(e.createdAt)}</span>
        {e.updatedAt !== e.createdAt && <span className="shrink-0 tnum" data-testid={`text-entry-edited-${e.id}`}>· edited {editedAt(e)}</span>}
        {e.archived && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium" data-testid={`text-entry-archived-${e.id}`}>
            <Archive className="h-3 w-3" /> Archived
          </span>
        )}
      </div>
      {/* The title (the item's, for an item's notes) on its own line under the time. */}
      {item ? (
        <button onClick={() => openDetails(item)} className="mt-1 block max-w-full truncate text-left text-sm font-semibold hover:underline" style={{ color: accentOf(item, settings) }} data-testid={`button-entry-item-${e.id}`}>
          {item.title}
        </button>
      ) : e.title ? (
        <div className="mt-1 truncate text-sm font-semibold text-foreground" data-testid={`text-entry-title-${e.id}`}>{e.title}</div>
      ) : null}
      <div className="mb-2" />
      <Clamp footer={<TagChips tags={extraTags} onClick={onTag} item={item} />}>
        <Body text={e.body} onTag={e.hashtags === false ? undefined : onTag} />
      </Clamp>
    </article>
  );
}

/** Long entries show their first few lines, fading out, with a chevron under their tags to open the rest. */
const CLAMP_PX = 168;
function Clamp({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setLong(el.scrollHeight > CLAMP_PX + 24);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el.firstElementChild ?? el);
    return () => ro.disconnect();
  }, []);
  const clamped = long && !open;
  return (
    <div className="grid gap-2.5">
      <div
        ref={ref}
        className="overflow-hidden"
        style={clamped ? { maxHeight: CLAMP_PX, maskImage: "linear-gradient(to bottom, black 55%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent)" } : undefined}
      >
        {children}
      </div>
      {footer}
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? "Show less" : "Show the whole entry"}
          className="-mb-3 -mt-2 mx-auto grid h-6 w-10 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="button-entry-expand">
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

/**
 * Rename or delete journal tags across every entry. The kind tags (#events, #tasks...) come from
 * items' notes and are added back automatically, so they aren't listed.
 */
function JournalTagManager({ open, onOpenChange, tags, counts, onRenamed }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  /** Tags saved on entries, and how many entries have each tag (task tags included). */
  tags: [string, number][]; counts: Map<string, number>;
  onRenamed: (from: string, to: string | null) => void;
}) {
  const { retag } = useJournalMutations();
  const own = tags.filter(([t]) => !KIND_OF_TAG.has(t));
  const entries = (t: string) => { const n = counts.get(t) ?? 0; return `${n} ${n === 1 ? "entry" : "entries"}`; };
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const rename = async (from: string) => {
    const to = cleanTag(name);
    setEditing(null);
    if (!to || to === from) return;
    onRenamed(from, to);
    await retag.mutateAsync({ from, to });
  };
  const remove = async (t: string) => {
    onRenamed(t, null);
    await retag.mutateAsync({ from: t, to: null });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setEditing(null); }}>
      <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto" data-testid="dialog-manage-journal-tags">
        <DialogTitle>Journal tags</DialogTitle>
        <DialogDescription className="sr-only">Rename or delete journal tags</DialogDescription>
        {own.length === 0 && <p className="text-sm text-muted-foreground">No tags yet. Add #hashtags or tags to your entries.</p>}
        <ul className="grid grid-cols-1 gap-1">
          {own.map(([t, n]) => {
            return (
              <li key={t} className="grid gap-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <button type="button" onClick={() => { setEditing(editing === t ? null : t); setName(t); }}
                    aria-expanded={editing === t} className="flex min-w-0 flex-1 items-center text-left" data-testid={`button-edit-journal-tag-${t}`}>
                    <span className="inline-flex h-6 items-center gap-0.5 rounded-full bg-accent px-2 text-xs font-medium text-accent-foreground">
                      <Hash className="h-3 w-3" />
                      {t}
                    </span>
                  </button>
                  <span className="text-xs text-muted-foreground tnum">{n} {n === 1 ? "entry" : "entries"}</span>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Delete tag ${t}`} onClick={() => remove(t)} data-testid={`button-delete-journal-tag-${t}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {editing === t && (
                  <div className="flex items-center gap-2 pl-1">
                    <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && rename(t)}
                      className="h-9" aria-label="Tag name" data-testid="input-rename-journal-tag" />
                    <Button size="sm" variant="outline" onClick={() => rename(t)} data-testid="button-rename-journal-tag">Save</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">Deleting a tag keeps its word in your entries, without the #.</p>
        {/* Tasks' tags show on their notes' entries; they're changed here or from the Tasks page. */}
        <div className="grid gap-3 border-t pt-4" data-testid="section-journal-task-tags">
          <h3 className="text-base font-semibold">Task tags</h3>
          {open && <TaskTagList countOf={entries} confirmDelete onRenamed={(from, to) => onRenamed(from, to)} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function JournalPage() {
  const [, params] = useRoute("/journal/:date");
  const [, nav] = useLocation();
  const day = params?.date ?? todayStr();
  const isToday = day === todayStr();
  const { data: entries, isLoading } = useJournal();
  const { create, update, remove } = useJournalMutations();
  const [q, setQ] = useState("");
  // The entry window: a new entry ({}), or the one being edited.
  const [compose, setCompose] = useState<{ entry?: JournalEntry } | null>(null);
  const saveEntry = useRef<(() => void) | null>(null);
  useEffect(() => { if (!compose) saveEntry.current = null; }, [compose]);
  const [managing, setManaging] = useState(false);
  // Entries holding an item's notes link to it.
  const { data: items } = useItems();
  const { openDetails, openEditor } = usePlanner();
  const { settings } = useSettings();
  const itemsById = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const itemOf = (e: JournalEntry) => (e.itemId ? itemsById.get(e.itemId) : undefined);
  // The app bar's + opens the entry window here.
  useEffect(() => {
    const f = () => { setQ(""); setCompose({}); };
    window.addEventListener("cadence:journal-compose", f);
    return () => window.removeEventListener("cadence:journal-compose", f);
  }, []);
  const all = entries ?? [];
  // Archived entries stay on their day but are left out of tag counts, and out of searches unless asked for.
  const live = useMemo(() => all.filter((e) => !e.archived), [all]);
  const archivedEntries = useMemo(() => all.filter((e) => e.archived).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)), [all]);
  const [inArchive, setInArchive] = useState(false);
  const [withArchived, setWithArchived] = useState(false);
  const entryDays = useMemo(() => new Set(all.map((e) => e.date)), [all]);

  const dayEntries = all.filter((e) => e.date === day).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const tagsOfEntry = (e: JournalEntry) => entryTags(e, itemOf(e), settings);
  const count = (tags: (e: JournalEntry) => string[], from = live) => {
    const m = new Map<string, number>();
    for (const e of from) for (const t of tags(e)) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  // Every tag to find entries by (task tags included), and the ones saved on entries themselves.
  const tagCounts = useMemo(() => count(tagsOfEntry), [live, itemsById, settings.taskTags]); // eslint-disable-line react-hooks/exhaustive-deps
  // Manage lists tags on archived entries too, so they can still be renamed or removed.
  const savedTagCounts = useMemo(() => count(tagsOf, all), [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const recentDays = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) m.set(e.date, (m.get(e.date) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8);
  }, [all]);

  const query = q.trim().toLowerCase();
  const matches = (e: JournalEntry) => query.split(/\s+/).every((t) =>
    t.startsWith("#") ? tagsOfEntry(e).includes(canonicalTag(t.slice(1)))
      : e.body.toLowerCase().includes(t) || !!e.title?.toLowerCase().includes(t) || tagsOfEntry(e).some((x) => x.includes(t)));
  const results = useMemo(() => (!query ? [] : (withArchived ? all : live).filter(matches).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    [all, live, withArchived, query, itemsById, settings.taskTags]); // eslint-disable-line react-hooks/exhaustive-deps
  // How many more there'd be with archived entries, for the "show archived entries" option.
  const archivedMatches = useMemo(() => (!query ? 0 : archivedEntries.filter(matches).length),
    [archivedEntries, query, itemsById, settings.taskTags]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tapping the tag being searched clears the search.
  // Tags are toggled in the search, so several can be picked at once (entries need all of them).
  const toggleTerm = (q: string, term: string, to?: string | null) => {
    const terms = q.trim().split(/\s+/).filter(Boolean);
    const has = terms.some((x) => x.toLowerCase() === term);
    const next = has ? terms.flatMap((x) => (x.toLowerCase() === term ? (to ? [to] : []) : [x])) : to === undefined ? [...terms, term] : terms;
    return next.join(" ");
  };
  const searchTag = (t: string) => setQ((q) => toggleTerm(q, `#${t}`));
  const picked = new Set(query.split(/\s+/).filter((x) => x.startsWith("#")));

  return (
    <>
      <PageHeader title={<DayPicker day={day} label={`${isToday ? "Today · " : ""}${fmtDate(day, { weekday: "long", month: "long", day: "numeric" })}`}
        marked={entryDays} onPick={(d) => nav(d === todayStr() ? "/journal" : `/journal/${d}`)} />}>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => nav(`/journal/${addDays(day, -1)}`)} aria-label="Previous day" data-testid="button-journal-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav("/journal")} disabled={isToday} data-testid="button-journal-today">
            Today
          </Button>
          <Button size="icon" variant="ghost" onClick={() => nav(`/journal/${addDays(day, 1)}`)} aria-label="Next day" data-testid="button-journal-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 p-4 md:p-6 max-w-6xl">
          {/* search (top on phones) */}
          <aside className="grid min-w-0 grid-cols-1 content-start gap-4 lg:order-2" aria-label="Search and tags">
            <div className="card-md p-3">
              <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded border px-2.5 focus-within:border-primary">
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search notes or #tag"
                  className="border-0 bg-transparent shadow-none px-0 h-10 focus-visible:ring-0 focus-visible:ring-offset-0"
                  data-testid="input-journal-search"
                />
                {q && (
                  <button onClick={() => setQ("")} className="text-muted-foreground hover:text-foreground" aria-label="Clear search" data-testid="button-clear-search">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {/* The Archive: entries put away by hand, and those of finished tasks and past events. */}
              <button type="button" onClick={() => { setInArchive((v) => !v); setQ(""); }} aria-pressed={inArchive}
                className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
                  inArchive ? "border-transparent bg-primary text-primary-foreground" : "text-muted-foreground hover-elevate")}
                data-testid="button-journal-archive-view">
                <Archive className="h-4 w-4" />
                Archive
              </button>
              </div>
              {tagCounts.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Tags</div>
                  <TwoRows className="gap-1.5" testId="tags-journal">
                    <button type="button" onClick={() => setManaging(true)}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary"
                      data-testid="button-manage-journal-tags">
                      <Settings2 className="h-3.5 w-3.5" />
                      Manage
                    </button>
                    {tagCounts.map(([t, n]) => (
                      <button
                        key={t}
                        onClick={() => searchTag(t)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full h-7 px-2.5 text-xs font-medium transition-colors",
                          picked.has(`#${t}`) ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent hover:text-accent-foreground",
                        )}
                        style={picked.has(`#${t}`) ? undefined : tagStyle(tagColor(t, settings))}
                        aria-pressed={picked.has(`#${t}`)}
                        data-testid={`button-tag-${t}`}
                      >
                        #{t}
                        <span className="opacity-70 tnum">{n}</span>
                      </button>
                    ))}
                  </TwoRows>
                </div>
              )}
            </div>
            {recentDays.length > 0 && (
              <div className="card-md hidden lg:block">
                <h2 className="text-sm font-medium px-4 pt-3 pb-1">Recent days</h2>
                <ul className="pb-2">
                  {recentDays.map(([d, n]) => (
                    <li key={d}>
                      <button
                        onClick={() => {
                          setQ("");
                          nav(d === todayStr() ? "/journal" : `/journal/${d}`);
                        }}
                        className={cn("flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-muted", d === day && "text-primary font-medium")}
                      >
                        {fmtDate(d, { weekday: "short", month: "short", day: "numeric" })}
                        <span className="text-xs text-muted-foreground tnum">
                          {n} {n === 1 ? "entry" : "entries"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
          {/* Tapping outside the window (or Back) saves the entry, like Save; Cancel leaves it as it was. */}
          <Dialog open={!!compose} onOpenChange={(o) => !o && (saveEntry.current ? saveEntry.current() : setCompose(null))}>
            <DialogContent hideClose className="flex max-h-[calc(100dvh-2rem-var(--safe-top,0px))] max-w-lg flex-col gap-0 overflow-hidden rounded-xl p-0" data-testid="dialog-journal-entry"
              // Start typing right away, at the end of an entry being edited.
              onOpenAutoFocus={(ev) => {
                ev.preventDefault();
                const area = (ev.currentTarget as HTMLElement).querySelector("textarea");
                area?.focus();
                area?.setSelectionRange(area.value.length, area.value.length);
              }}>
              <DialogTitle className="sr-only">{compose?.entry ? "Edit entry" : "New entry"}</DialogTitle>
              <DialogDescription className="sr-only">{fmtDate(compose?.entry?.date ?? day, { weekday: "long", month: "long", day: "numeric" })}</DialogDescription>
              {compose && (
                <Composer
                  key={compose.entry?.id ?? "new"}
                  initialTitle={compose.entry?.title ?? ""}
                  initial={compose.entry?.body}
                  initialTags={compose.entry ? tagsOf(compose.entry) : []}
                  initialHashtags={compose.entry?.hashtags !== false}
                  submitLabel={compose.entry ? "Save" : "Add entry"}
                  busy={create.isPending || update.isPending}
                  saveRef={saveEntry}
                  onCancel={() => setCompose(null)}
                  // An entry holding an item's notes is changed from that item, so it has no delete.
                  onDelete={compose.entry && !compose.entry.itemId ? () => {
                    const id = compose.entry!.id;
                    saveEntry.current = null;
                    setCompose(null);
                    remove.mutate(id);
                  } : undefined}
                  archived={!!compose.entry?.archived}
                  onArchive={compose.entry ? (title, body, tags, hashtags) => {
                    const entry = compose.entry!;
                    saveEntry.current = null;
                    setCompose(null);
                    update.mutate({ id: entry.id, archived: !entry.archived, ...(body.trim() ? { title, body, tags, hashtags } : {}) });
                  } : undefined}
                  onSubmit={async (title, body, tags, hashtags) => {
                    if (compose.entry) await update.mutateAsync({ id: compose.entry.id, title, body, tags, hashtags });
                    else await create.mutateAsync({ date: day, title, body, tags, hashtags });
                    setCompose(null);
                  }}
                  onConvert={(to) => {
                    const entry = compose.entry;
                    setCompose(null);
                    // A new task takes the entry's first tag that's a task tag (a task has one tag). The entry
                    // shows it from the task, so it isn't also saved on the entry.
                    const taskTag = to.kind === "task" ? to.tags.find((t) => settings.taskTags?.some((x) => x.name === t)) : undefined;
                    const kept = to.tags.filter((t) => t !== taskTag);
                    // The new item's notes become its journal entry, which replaces this one once the item is saved.
                    openEditor({ kind: to.kind, title: to.title, notes: to.body, date: entry?.date ?? day, ...(taskTag ? { tags: JSON.stringify([taskTag]) } : {}) },
                      undefined, async (item) => {
                        if (entry) await remove.mutateAsync(entry.id);
                        if (item.journalId && kept.length) await update.mutateAsync({ id: item.journalId, tags: [...kept, KIND_TAGS[to.kind]] });
                      });
                  }}
                />
              )}
            </DialogContent>
          </Dialog>
          <JournalTagManager open={managing} onOpenChange={setManaging} tags={savedTagCounts} counts={new Map(tagCounts)}
            onRenamed={(from, to) => setQ((q) => toggleTerm(q, `#${from}`, to ? `#${to}` : null))} />

          <section className="grid min-w-0 grid-cols-1 content-start gap-4 lg:order-1" aria-label="Entries">
            {query ? (
              <>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
                  <span className="text-muted-foreground" data-testid="text-search-count">
                    {results.length} {results.length === 1 ? "entry" : "entries"} for
                  </span>
                  <span className="min-w-0 break-words font-medium">{q.trim()}</span>
                  {archivedEntries.length > 0 && (
                    <button type="button" onClick={() => setWithArchived((v) => !v)} aria-pressed={withArchived}
                      className={cn("ml-auto inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors",
                        withArchived ? "border-transparent bg-primary text-primary-foreground" : "border-dashed text-muted-foreground hover:border-primary hover:text-primary")}
                      data-testid="button-search-archived">
                      <Archive className="h-3.5 w-3.5" />
                      Show archived entries{!withArchived && archivedMatches ? ` (${archivedMatches})` : ""}
                    </button>
                  )}
                </div>
                {results.length === 0 ? (
                  <div className="card-md p-8 text-center text-sm text-muted-foreground">Nothing matches that yet.</div>
                ) : (
                  results.map((e) => <EntryCard key={e.id} e={e} onTag={searchTag} showDate item={itemOf(e)} openDetails={openDetails} onEdit={(entry) => setCompose({ entry })} />)
                )}
              </>
            ) : inArchive ? (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Archive</h2>
                  <span className="text-sm text-muted-foreground tnum" data-testid="text-archive-count">
                    {archivedEntries.length} {archivedEntries.length === 1 ? "entry" : "entries"}
                  </span>
                  <Button size="icon" variant="ghost" className="ml-auto h-8 w-8" onClick={() => setInArchive(false)} aria-label="Close the archive" data-testid="button-close-archive">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {archivedEntries.length === 0 ? (
                  <div className="card-md p-8 text-center text-sm text-muted-foreground">
                    Nothing archived yet. Entries of finished tasks and past events land here, and any entry can be archived from its edit window.
                  </div>
                ) : (
                  archivedEntries.map((e) => <EntryCard key={e.id} e={e} onTag={(t) => { setInArchive(false); searchTag(t); }} showDate item={itemOf(e)} openDetails={openDetails} onEdit={(entry) => setCompose({ entry })} />)
                )}
              </>
            ) : (
              <>
                {/* Looks like the Tasks page's add field; tapping it opens the entry window. */}
                <button type="button" onClick={() => setCompose({})}
                  className="flex w-full items-center gap-2 card-md px-3 h-11 text-left text-base text-muted-foreground"
                  data-testid="button-journal-new">
                  <Plus className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate text-[14px] italic">{settings.plain ? "Had a shower thought #ideas" : "Got the zoomies #exercise"}</span>
                </button>
                {isLoading ? (
                  <Skeleton className="h-24" />
                ) : dayEntries.length === 0 ? (
                  <div className="py-12 grid justify-items-center gap-2 text-center">
                    <div className="h-12 w-12 rounded-full bg-accent grid place-items-center text-primary">
                      <NotebookPen className="h-5 w-5" />
                    </div>
                    <div className="font-medium">There's nothing here yet...</div>
                  </div>
                ) : (
                  dayEntries.map((e) => <EntryCard key={e.id} e={e} onTag={searchTag} item={itemOf(e)} openDetails={openDetails} onEdit={(entry) => setCompose({ entry })} />)
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
