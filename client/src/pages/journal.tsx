import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { KIND_TAGS, type Item, type JournalEntry, type Kind } from "@shared/schema";
import { PageHeader } from "@/components/shell";
import { hashtagsIn, tagsOf, useItems, useJournal, useJournalMutations, useSettings } from "@/lib/data";
import { DAY_SHORT, KIND_META, addDays, colorOf, fmtDate, kindOf, parseYmd, startOfWeek, todayStr, ymd } from "@/lib/cal";
import { PickerTitle, StepHeader } from "@/pages/calendar";
import { usePlanner } from "@/components/planner";
import { cleanTag, tagTint } from "@/components/taskTags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronLeft, ChevronRight, Hash, Settings2, NotebookPen, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** A kind tag (#events, #tasks...) takes its item's color, or its kind's; other tags keep the accent. */
const KIND_OF_TAG = new Map(Object.entries(KIND_TAGS).map(([k, t]) => [t, k as Kind]));
function tagColor(t: string, item?: Item): string | undefined {
  const kind = KIND_OF_TAG.get(t);
  if (!kind) return undefined;
  return item && kindOf(item) === kind ? colorOf(item) : `hsl(var(${KIND_META[kind].cssVar}))`;
}
const tagStyle = (color?: string) => (color ? tagTint(color) : undefined);

/** Entries mark **bold**, *italic* and __underline__ in their text (the composer's format buttons add them). */
const FORMAT = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*[^*\n]+?\*)/;
function Rich({ text, onTag }: { text: string; onTag: (t: string) => void }) {
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
function Body({ text, onTag }: { text: string; onTag: (t: string) => void }) {
  return (
    <p className="text-[16px] leading-relaxed whitespace-pre-wrap break-words">
      <Rich text={text} onTag={onTag} />
    </p>
  );
}

function Tagged({ text, onTag }: { text: string; onTag: (t: string) => void }) {
  const parts = text.split(/((?:^|\s)#[\p{L}\p{N}_-]+)/gu);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^(\s?)#([\p{L}\p{N}_-]+)$/u);
        if (!m) return <span key={i}>{p}</span>;
        return (
          <span key={i}>
            {m[1]}
            <button onClick={() => onTag(m[2].toLowerCase())} className="text-primary font-medium hover:underline">
              #{m[2]}
            </button>
          </span>
        );
      })}
    </>
  );
}

function TagChips({ tags, onRemove, onClick, item }: { tags: string[]; onRemove?: (t: string) => void; onClick?: (t: string) => void; item?: Item }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-0.5 rounded-full bg-accent text-accent-foreground pl-2 pr-2 h-6 text-xs font-medium" style={tagStyle(tagColor(t, item))}>
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
    </div>
  );
}

const SUGGESTED = ["idea", "gratitude", "health", "sleep", "work", "mood", "win", "todo", "family", "learning"];

/** "add tag" button → type a new tag or pick from suggestions */
function TagPicker({ taken, onAdd }: { taken: string[]; onAdd: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: entries } = useJournal();
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries ?? []) for (const t of tagsOf(e)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [entries]);
  const typed = cleanTag(q);
  const pool = [...new Set([...[...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b)), ...SUGGESTED])];
  const options = pool.filter((t) => !taken.includes(t) && (!typed || t.includes(typed))).slice(0, 12);
  const add = (t: string) => {
    if (!t) return;
    onAdd(t);
    setQ("");
  };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 rounded-full border border-dashed h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary" data-testid="button-add-tag">
          <Plus className="h-3.5 w-3.5" />
          add tag
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0 rounded shadow-lg">
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
        <div className="max-h-60 overflow-y-auto py-1" role="listbox" aria-label="Tag suggestions">
          {typed && !pool.includes(typed) && !taken.includes(typed) && (
            <button onClick={() => add(typed)} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left" data-testid="button-create-tag">
              <Plus className="h-3.5 w-3.5 text-primary" />
              Create <span className="font-medium text-primary">#{typed}</span>
            </button>
          )}
          {options.length === 0 && !typed ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No more suggestions</div>
          ) : (
            options.map((t) => (
              <button key={t} onClick={() => add(t)} className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted text-left" role="option" data-testid={`option-tag-${t}`}>
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

/**
 * Textarea, tags and format buttons, used for new and edited entries. The new entry window uses the
 * "keep" look: a borderless note with a toolbar along the bottom.
 */
function Composer({
  initial = "",
  initialTags = [],
  submitLabel,
  onSubmit,
  onCancel,
  busy,
  keep,
}: {
  initial?: string;
  initialTags?: string[];
  submitLabel: string;
  onSubmit: (body: string, tags: string[]) => Promise<unknown> | void;
  onCancel?: () => void;
  busy?: boolean;
  keep?: boolean;
}) {
  const [sel, setSel] = useState<[number, number]>([initial.length, initial.length]);
  const [body, setBody] = useState(initial);
  const [extra, setExtra] = useState<string[]>(initialTags.filter((t) => !hashtagsIn(initial).includes(t)));
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
  const inline = hashtagsIn(body);
  const all = [...new Set([...inline, ...extra])];
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
  const submit = async () => {
    if (!body.trim()) return;
    await onSubmit(body, all);
    if (!onCancel) {
      setBody("");
      setExtra([]);
    }
  };
  return (
    <div className={cn("grid", keep ? "gap-2" : "gap-3")}>
      <Textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder={keep ? "Jot something down…" : "Jot something down. Use #hashtags to tag it."}
        className={keep
          ? "min-h-[128px] resize-none rounded-none border-0 bg-transparent px-4 pb-1 pt-4 text-[16px] leading-relaxed shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          : "min-h-[96px] resize-y text-[16px] leading-relaxed"}
        data-testid="input-journal-body"
      />
      <div className={cn("flex flex-wrap items-center gap-2", keep && "px-4")}>
        <TagChips tags={all} onRemove={(t) => (inline.includes(t) ? setBody(body.replace(new RegExp(`(^|\\s)#${t}\\b`, "i"), "$1")) : setExtra(extra.filter((x) => x !== t)))} />
        <TagPicker taken={all} onAdd={(t) => !all.includes(t) && setExtra((x) => [...x, t])} />
      </div>
      <div className={cn("flex items-center gap-1.5", keep && "px-4 pb-4")}>
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
          <Button size="sm" onClick={submit} disabled={!body.trim() || busy} data-testid="button-journal-save">
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EntryCard({ e, onTag, showDate, item, openDetails }: {
  e: JournalEntry; onTag: (t: string) => void; showDate?: boolean; item?: Item; openDetails: (i: Item) => void;
}) {
  const [editing, setEditing] = useState(false);
  const { update, remove } = useJournalMutations();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const tags = tagsOf(e);
  const extraTags = tags.filter((t) => !hashtagsIn(e.body).includes(t));
  return (
    <article
      className={cn("card-md p-4 group", item && !editing && "cursor-pointer")}
      // An entry holding an item's notes opens that item; its buttons, tags and links keep their own taps.
      onClick={(ev) => item && !editing && !(ev.target as HTMLElement).closest("button, a, input, textarea") && openDetails(item)}
      data-testid={`card-entry-${e.id}`}
    >
      <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
        {showDate ? (
          <button onClick={() => nav(`/journal/${e.date}`)} className="font-medium text-foreground hover:text-primary">
            {fmtDate(e.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          </button>
        ) : null}
        {item ? (
          <button onClick={() => openDetails(item)} className="min-w-0 truncate font-medium hover:underline" style={{ color: colorOf(item) }} data-testid={`button-entry-item-${e.id}`}>
            {item.title}
          </button>
        ) : <span className="tnum">{timeOf(e.createdAt)}</span>}
        {e.updatedAt !== e.createdAt && <span>· edited</span>}
        {/* An entry holding an item's notes is changed from that item, so it has no edit or delete. */}
        {!editing && !e.itemId && (
          <div className="ml-auto flex items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(true)} aria-label="Edit entry" data-testid={`button-edit-entry-${e.id}`}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                remove.mutate(e.id);
                toast({ title: "Entry deleted" });
              }}
              aria-label="Delete entry"
              data-testid={`button-delete-entry-${e.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      {editing ? (
        <Composer
          initial={e.body}
          initialTags={tags}
          submitLabel="Save"
          busy={update.isPending}
          onCancel={() => setEditing(false)}
          onSubmit={async (body, t) => {
            await update.mutateAsync({ id: e.id, body, tags: t });
            setEditing(false);
          }}
        />
      ) : (
        <Clamp footer={<TagChips tags={extraTags} onClick={onTag} item={item} />}>
          <Body text={e.body} onTag={onTag} />
        </Clamp>
      )}
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

/** The journal's date title opens a month calendar; days with entries have a small dot. */
function DayPicker({ day, label, marked, onPick }: { day: string; label: string; marked: Set<string>; onPick: (d: string) => void }) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const firstOf = (d: string) => { const x = parseYmd(d); return new Date(x.getFullYear(), x.getMonth(), 1); };
  const [view, setView] = useState(() => firstOf(day));
  useEffect(() => { if (open) setView(firstOf(day)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthStart = ymd(view);
  const monthEnd = ymd(new Date(view.getFullYear(), view.getMonth() + 1, 0));
  const gridStart = startOfWeek(monthStart, settings.weekStartsOn);
  const cells: string[] = [];
  for (let d = gridStart; d <= monthEnd || cells.length % 7; d = addDays(d, 1)) cells.push(d);
  const today = todayStr();
  return (
    <PickerTitle label={label} open={open} onOpenChange={setOpen} testId="button-pick-journal-day">
      <StepHeader label={fmtDate(monthStart, { month: "long", year: "numeric" })} unit="month"
        onPrev={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
        onNext={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} />
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {Array.from({ length: 7 }, (_, n) => (
          <div key={n} className="pb-1 text-xs text-muted-foreground">{DAY_SHORT[(n + settings.weekStartsOn) % 7].slice(0, 2)}</div>
        ))}
        {cells.map((d) => {
          const inMonth = d >= monthStart && d <= monthEnd;
          const selected = d === day;
          return (
            <button key={d} type="button" onClick={() => { onPick(d); setOpen(false); }}
              className={cn("relative grid h-9 place-items-center rounded-md text-sm tnum transition-colors",
                selected ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-muted",
                !inMonth && !selected && "text-muted-foreground/50", d === today && !selected && "text-primary font-semibold")}
              aria-pressed={selected} aria-label={`${fmtDate(d, { weekday: "long", month: "long", day: "numeric" })}${marked.has(d) ? ", has entries" : ""}`}
              data-testid={`button-pick-day-${d}`}>
              {parseYmd(d).getDate()}
              {marked.has(d) && (
                <span className={cn("absolute bottom-1 h-1 w-1 rounded-full", selected ? "bg-primary-foreground" : "bg-primary")} aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </PickerTitle>
  );
}

/**
 * Rename or delete journal tags across every entry. The kind tags (#events, #tasks...) come from
 * items' notes and are added back automatically, so they aren't listed.
 */
function JournalTagManager({ open, onOpenChange, tags, onRenamed }: {
  open: boolean; onOpenChange: (o: boolean) => void; tags: [string, number][]; onRenamed: (from: string, to: string | null) => void;
}) {
  const { retag } = useJournalMutations();
  const own = tags.filter(([t]) => !KIND_OF_TAG.has(t));
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
  const { create } = useJournalMutations();
  const [q, setQ] = useState("");
  const [composing, setComposing] = useState(false);
  const [managing, setManaging] = useState(false);
  // Entries holding an item's notes link to it.
  const { data: items } = useItems();
  const { openDetails } = usePlanner();
  const itemsById = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const itemOf = (e: JournalEntry) => (e.itemId ? itemsById.get(e.itemId) : undefined);
  // The app bar's + opens the entry window here.
  useEffect(() => {
    const f = () => { setQ(""); setComposing(true); };
    window.addEventListener("cadence:journal-compose", f);
    return () => window.removeEventListener("cadence:journal-compose", f);
  }, []);
  const all = entries ?? [];
  const entryDays = useMemo(() => new Set(all.map((e) => e.date)), [all]);

  const dayEntries = all.filter((e) => e.date === day).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) for (const t of tagsOf(e)) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [all]);
  const recentDays = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) m.set(e.date, (m.get(e.date) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8);
  }, [all]);

  const query = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!query) return [];
    const terms = query.split(/\s+/);
    return all
      .filter((e) =>
        terms.every((t) =>
          t.startsWith("#") ? tagsOf(e).includes(t.slice(1)) : e.body.toLowerCase().includes(t) || tagsOf(e).some((x) => x.includes(t)),
        ),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [all, query]);

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
              <div className="flex items-center gap-2 rounded border px-2.5 focus-within:border-primary">
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
              {tagCounts.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Tags</div>
                  <div className="flex flex-wrap gap-1.5">
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
                        style={picked.has(`#${t}`) ? undefined : tagStyle(tagColor(t))}
                        aria-pressed={picked.has(`#${t}`)}
                        data-testid={`button-tag-${t}`}
                      >
                        #{t}
                        <span className="opacity-70 tnum">{n}</span>
                      </button>
                    ))}
                  </div>
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
          <JournalTagManager open={managing} onOpenChange={setManaging} tags={tagCounts}
            onRenamed={(from, to) => setQ((q) => toggleTerm(q, `#${from}`, to ? `#${to}` : null))} />

          <section className="grid min-w-0 grid-cols-1 content-start gap-4 lg:order-1" aria-label="Entries">
            {query ? (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground" data-testid="text-search-count">
                    {results.length} {results.length === 1 ? "entry" : "entries"} for
                  </span>
                  <span className="font-medium">{q.trim()}</span>
                </div>
                {results.length === 0 ? (
                  <div className="card-md p-8 text-center text-sm text-muted-foreground">Nothing matches that yet.</div>
                ) : (
                  results.map((e) => <EntryCard key={e.id} e={e} onTag={searchTag} showDate item={itemOf(e)} openDetails={openDetails} />)
                )}
              </>
            ) : (
              <>
                {/* Looks like the Tasks page's add field; tapping it opens the entry window. */}
                <button type="button" onClick={() => setComposing(true)}
                  className="flex w-full items-center gap-2 card-md px-3 h-11 text-left text-base text-muted-foreground"
                  data-testid="button-journal-new">
                  <Plus className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate text-[14px] italic">Got the zoomies #exercise</span>
                </button>
                <Dialog open={composing} onOpenChange={setComposing}>
                  <DialogContent hideClose className="max-w-lg gap-0 overflow-hidden rounded-xl p-0" data-testid="dialog-journal-new"
                    // Start typing right away.
                    onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("textarea")?.focus(); }}>
                    <DialogTitle className="sr-only">New entry</DialogTitle>
                    <DialogDescription className="sr-only">{fmtDate(day, { weekday: "long", month: "long", day: "numeric" })}</DialogDescription>
                    <Composer
                      keep
                      submitLabel="Add entry"
                      busy={create.isPending}
                      onCancel={() => setComposing(false)}
                      onSubmit={async (body, tags) => {
                        await create.mutateAsync({ date: day, body, tags });
                        setComposing(false);
                      }}
                    />
                  </DialogContent>
                </Dialog>
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
                  dayEntries.map((e) => <EntryCard key={e.id} e={e} onTag={searchTag} item={itemOf(e)} openDetails={openDetails} />)
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
