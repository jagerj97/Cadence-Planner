import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { KIND_TAGS, type Item, type JournalEntry, type Kind } from "@shared/schema";
import { PageHeader } from "@/components/shell";
import { hashtagsIn, tagsOf, useItems, useJournal, useJournalMutations } from "@/lib/data";
import { KIND_META, addDays, colorOf, fmtDate, kindOf, todayStr } from "@/lib/cal";
import { usePlanner } from "@/components/planner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Baseline, Bold, ChevronDown, ChevronLeft, Italic, Underline, ChevronRight, Hash, NotebookPen, Pencil, Plus, Search, Trash2, X } from "lucide-react";
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
const tagStyle = (color?: string) => color ? { background: `color-mix(in srgb, ${color} 18%, transparent)`, color: `color-mix(in srgb, ${color} 75%, hsl(var(--foreground)))` } : undefined;

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
const cleanTag = (t: string) => t.trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "");

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
  { mark: "**", label: "Bold", icon: Bold },
  { mark: "*", label: "Italic", icon: Italic },
  { mark: "__", label: "Underline", icon: Underline },
] as const;

/**
 * Textarea, tags and format buttons, used for new and edited entries. The new entry window uses the
 * "keep" look: a borderless note with its day as the heading and a toolbar along the bottom.
 */
function Composer({
  initial = "",
  initialTags = [],
  submitLabel,
  onSubmit,
  onCancel,
  busy,
  keep,
  heading,
}: {
  initial?: string;
  initialTags?: string[];
  submitLabel: string;
  onSubmit: (body: string, tags: string[]) => Promise<unknown> | void;
  onCancel?: () => void;
  busy?: boolean;
  keep?: boolean;
  heading?: React.ReactNode;
}) {
  const [formatting, setFormatting] = useState(false);
  const [body, setBody] = useState(initial);
  const [extra, setExtra] = useState<string[]>(initialTags.filter((t) => !hashtagsIn(initial).includes(t)));
  const ref = useRef<HTMLTextAreaElement>(null);
  const inline = hashtagsIn(body);
  const all = [...new Set([...inline, ...extra])];
  // Wraps the selection in a format's marks, or unwraps it if it already has them.
  const format = (mark: string) => {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    const before = body.slice(0, a), sel = body.slice(a, b), after = body.slice(b);
    const n = mark.length;
    // A lone * next to ** belongs to bold, not italic.
    const around = before.endsWith(mark) && after.startsWith(mark) && (mark !== "*" || !before.endsWith("**") || before.endsWith("***"));
    let next: string, s: number, e: number;
    if (around) [next, s, e] = [before.slice(0, -n) + sel + after.slice(n), a - n, b - n];
    else if (sel.length > 2 * n && sel.startsWith(mark) && sel.endsWith(mark)) [next, s, e] = [before + sel.slice(n, -n) + after, a, b - 2 * n];
    else [next, s, e] = [before + mark + sel + mark + after, a + n, b + n];
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s, e); });
  };
  const submit = async () => {
    if (!body.trim()) return;
    await onSubmit(body, all);
    if (!onCancel) {
      setBody("");
      setExtra([]);
    }
  };
  const iconBtn = "grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground";
  return (
    <div className={cn("grid", keep ? "gap-2" : "gap-3")}>
      {heading}
      <Textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder={keep ? "Take a note…" : "Jot something down. Use #hashtags to tag it."}
        className={keep
          ? "min-h-[128px] resize-none rounded-none border-0 bg-transparent px-4 py-1 text-[16px] leading-relaxed shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          : "min-h-[96px] resize-y text-[16px] leading-relaxed"}
        data-testid="input-journal-body"
      />
      <div className={cn("flex flex-wrap items-center gap-2", keep && "px-4")}>
        <TagChips tags={all} onRemove={(t) => (inline.includes(t) ? setBody(body.replace(new RegExp(`(^|\\s)#${t}\\b`, "i"), "$1")) : setExtra(extra.filter((x) => x !== t)))} />
        <TagPicker taken={all} onAdd={(t) => !all.includes(t) && setExtra((x) => [...x, t])} />
      </div>
      {formatting && (
        <div className={cn("flex items-center gap-1", keep ? "px-2" : "-mx-2")} role="toolbar" aria-label="Text formatting">
          {FORMATS.map(({ mark, label, icon: Icon }) => (
            // pointerdown keeps the textarea's selection
            <button key={label} type="button" className={iconBtn} onPointerDown={(e) => e.preventDefault()} onClick={() => format(mark)}
              aria-label={label} title={label} data-testid={`button-format-${label.toLowerCase()}`}>
              <Icon className="h-[18px] w-[18px]" />
            </button>
          ))}
        </div>
      )}
      <div className={cn("flex items-center gap-1", keep ? "px-2 pb-2" : "-mx-2")}>
        <button type="button" className={cn(iconBtn, formatting && "bg-muted text-foreground")} onPointerDown={(e) => e.preventDefault()}
          onClick={() => setFormatting((v) => !v)} aria-pressed={formatting} aria-label="Text formatting" title="Text formatting" data-testid="button-journal-format">
          <Baseline className="h-[18px] w-[18px]" />
        </button>
        <div className="ml-auto flex items-center gap-1">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel} data-testid="button-journal-cancel">
              Cancel
            </Button>
          )}
          <Button variant={keep ? "ghost" : "default"} size="sm" onClick={submit} disabled={!body.trim() || busy}
            className={cn(keep && "font-semibold text-primary hover:text-primary")} data-testid="button-journal-save">
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EntryCard({ e, onTag, showDate }: { e: JournalEntry; onTag: (t: string) => void; showDate?: boolean }) {
  const [editing, setEditing] = useState(false);
  const { update, remove } = useJournalMutations();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const tags = tagsOf(e);
  const extraTags = tags.filter((t) => !hashtagsIn(e.body).includes(t));
  const { data: items } = useItems();
  const { openDetails } = usePlanner();
  const item = e.itemId ? items?.find((i) => i.id === e.itemId) : undefined;
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
        {!editing && (
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

export default function JournalPage() {
  const [, params] = useRoute("/journal/:date");
  const [, nav] = useLocation();
  const day = params?.date ?? todayStr();
  const isToday = day === todayStr();
  const { data: entries, isLoading } = useJournal();
  const { create } = useJournalMutations();
  const [q, setQ] = useState("");
  const [composing, setComposing] = useState(false);
  // The app bar's + opens the entry window here.
  useEffect(() => {
    const f = () => { setQ(""); setComposing(true); };
    window.addEventListener("cadence:journal-compose", f);
    return () => window.removeEventListener("cadence:journal-compose", f);
  }, []);
  const all = entries ?? [];

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

  const searchTag = (t: string) => setQ(`#${t}`);

  return (
    <>
      <PageHeader title={`${isToday ? "Today · " : ""}${fmtDate(day, { weekday: "long", month: "long", day: "numeric" })}`}>
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
                    {tagCounts.map(([t, n]) => (
                      <button
                        key={t}
                        onClick={() => searchTag(t)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full h-7 px-2.5 text-xs font-medium transition-colors",
                          query === `#${t}` ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent hover:text-accent-foreground",
                        )}
                        style={query === `#${t}` ? undefined : tagStyle(tagColor(t))}
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
                  results.map((e) => <EntryCard key={e.id} e={e} onTag={searchTag} showDate />)
                )}
              </>
            ) : (
              <>
                {/* Looks like the Tasks page's add field; tapping it opens the entry window. */}
                <button type="button" onClick={() => setComposing(true)}
                  className="flex w-full items-center gap-2 card-md px-3 h-11 text-left text-base text-muted-foreground"
                  data-testid="button-journal-new">
                  <Plus className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate">Write an entry…</span>
                </button>
                <Dialog open={composing} onOpenChange={setComposing}>
                  <DialogContent hideClose className="max-w-lg gap-0 overflow-hidden rounded-xl p-0" data-testid="dialog-journal-new"
                    // Start typing right away.
                    onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector("textarea")?.focus(); }}>
                    <DialogDescription className="sr-only">New journal entry</DialogDescription>
                    <Composer
                      keep
                      heading={<DialogTitle className="px-4 pt-4 text-lg font-medium text-muted-foreground">{fmtDate(day, { weekday: "long", month: "long", day: "numeric" })}</DialogTitle>}
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
                    <div className="font-medium">No entries {isToday ? "today" : "this day"}</div>
                    <p className="text-sm text-muted-foreground max-w-xs">Thoughts, ideas, how you slept, what went well. Each note is saved as its own entry.</p>
                  </div>
                ) : (
                  dayEntries.map((e) => <EntryCard key={e.id} e={e} onTag={searchTag} />)
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
