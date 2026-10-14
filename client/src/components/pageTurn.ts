/**
 * Page turns: how one page (or one date of a page) gives way to the next, whether dragged, tapped or
 * navigated to. The page to the left always lies on top of the one to its right:
 * - going to the next page, the old one slides off to the left, uncovering the new one beneath, which
 *   drifts over from the right;
 * - going back, the new one slides in over the old from the left, the old drifting off to the right.
 * Either way the new page fades in over the first part of the turn, so one that takes a few frames to
 * draw (see lib/hashLocation) eases in rather than popping in.
 * A date changes as if the days (weeks, months) were one long page: only the page's content (marked
 * data-turn-body) slides along, the next date's right beside the last; across, or (data-turn-body="y",
 * the calendar) up and down, clipped to where the content sits. Its header (data-turn-head, with the
 * date) is held as it was until the new date has slid all the way in, then updates.
 *
 * The old page (or content) is a copy laid over `main` (which can't be tapped); the real one is moved
 * by its own inline transform, which only shifts its layer (nothing is styled again, so each frame
 * is cheap). A page React swaps in mid-turn is moved to the same place before it's drawn.
 */

import { reducedMotion as reduced } from "./motion";

export type TurnMode = "page" | "date";
type Axis = "x" | "y";
export type TurnState = {
  main: HTMLElement; cover: HTMLElement; dir: 1 | -1; mode: TurnMode; axis: Axis; size: number; held?: HTMLElement;
  /** What moves in the copy (the copy, or for a date sliding up and down, its content inside the clip). */
  coverMover: HTMLElement;
  /** The real page (or content) being moved, as it is now (React may have swapped it), and how it's set apart while it moves. */
  moving: () => HTMLElement | null; look: Partial<CSSStyleDeclaration>;
  /** Where it is now, how faded in, and the transition there. */
  pos: number; fade: number; t: string; from: HTMLElement;
  /** What clips a date sliding up and down (the content's box), and how far it was scrolled. */
  clip?: HTMLElement; scrolled?: number;
  styled: Set<HTMLElement>; watch: MutationObserver;
};
/** The styles a turn puts on the moving page, cleared from it afterwards. */
const MOVED = ["transform", "transition", "position", "zIndex", "background", "boxShadow", "willChange", "opacity", "clipPath"] as const;
const EASE = "cubic-bezier(.2,.7,.3,1)";
const SHADOW = "0 0 32px 2px rgb(0 0 0 / .45)";
/** The new page is all the way in by this far through a turn. */
const FADE_BY = 0.15;

const shift = (axis: Axis, v: number) => (axis === "x" ? `translateX(${v}px)` : `translateY(${v}px)`);

/** Puts the moving page where the turn has it. */
function place(s: TurnState) {
  const el = s.moving();
  if (!el) return;
  if (!s.styled.has(el)) {
    Object.assign(el.style, s.look);
    s.styled.add(el);
  }
  el.style.transition = s.t;
  el.style.transform = shift(s.axis, s.pos);
  // The old page, until the new one is drawn, isn't shown twice; the new one fades in.
  if (s.mode === "page") el.style.opacity = el === s.from ? "0" : String(s.fade);
}

/** Whether a turn is under way (or settling): another can't start, and navigating doesn't add one. */
let busy = false;
export const turning = () => busy;
/** Until when an address change is a drag being taken back (history.back() arrives later), not a new turn. */
let quietUntil = 0;

/**
 * Shows a copied page as scrolled as the original (a copy starts at the top). The positions are read
 * from the original, which is already laid out, and the copy's content is shifted by them instead of
 * scrolled, so the copy needn't be laid out there and then (that made a swipe stall as it began).
 * Only what can scroll is looked at; the copy has the same elements in the same order.
 */
function copyScroll(from: Element, to: Element) {
  const sel = '[class*="overflow-"]';
  const a = [from, ...from.querySelectorAll(sel)];
  const scrolled = a.map((x) => [x.scrollTop, x.scrollLeft]);
  if (!scrolled.some(([t, l]) => t || l)) return;
  const b = [to, ...to.querySelectorAll(sel)];
  scrolled.forEach(([t, l], n) => {
    const y = b[n] as HTMLElement | undefined;
    if (!y || !(t || l)) return;
    y.style.overflow = "hidden";
    for (const child of y.children) (child as HTMLElement).style.translate = `${-l}px ${-t}px`;
  });
}

/** A still copy of `el` laid over `main` at `box` (it can't be tapped), so it looks unchanged while the real one changes. */
function copyOf(el: HTMLElement, box: DOMRect, frameBox: DOMRect, look: Partial<CSSStyleDeclaration>) {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  copy.querySelectorAll("[data-testid]").forEach((n) => n.removeAttribute("data-testid"));
  copy.removeAttribute("data-page");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  copy.classList.add("page-cover");
  Object.assign(copy.style, {
    position: "absolute", left: `${box.left - frameBox.left}px`, top: `${box.top - frameBox.top}px`, width: `${box.width}px`,
    height: `${box.height}px`, margin: "0", pointerEvents: "none", ...look,
  });
  return copy;
}

/** Lays a copy of `page` over `main`, and sets the turn going with nothing moved yet. */
export function startTurn(main: HTMLElement, page: HTMLElement, dir: 1 | -1, mode: TurnMode): TurnState {
  busy = true;
  // A date moves only the page's content (a page without it marked moves whole).
  const body = mode === "date" ? page.querySelector<HTMLElement>("[data-turn-body]") ?? page : page;
  const axis: Axis = mode === "date" && body.dataset.turnBody === "y" ? "y" : "x";
  // Up and down, the content moves inside its box, which clips it (so it doesn't pass over the header and filters).
  const inner = axis === "y" ? (body.firstElementChild as HTMLElement | null) : null;
  // Measured before the copies go in, while the page is still laid out as it is.
  const box = body.getBoundingClientRect(), frameBox = main.getBoundingClientRect();
  const head = mode === "date" ? page.querySelector<HTMLElement>("[data-turn-head]") : null;
  const headBox = head?.getBoundingClientRect();
  const innerBox = inner?.getBoundingClientRect();
  // Going back, the old page lies under the new one; otherwise on top. Dates sit side by side.
  const under = mode === "page" && dir < 0;
  const cover = copyOf(body, box, frameBox, {
    zIndex: under ? "0" : "2", willChange: "transform",
    background: mode === "date" ? "transparent" : "hsl(var(--background))",
    boxShadow: mode === "page" && !under ? SHADOW : "none",
    ...(inner ? { overflow: "hidden" } : {}),
  });
  copyScroll(body, cover);
  // Up and down, the new date comes in from its top, one screenful of it (the rest clipped), right
  // against the old one's edge. Its box is scrolled back to the top while the old date is out of view.
  const scrolled = body.scrollTop, view = body.clientHeight;
  if (inner) {
    body.scrollTop = 0;
    body.style.overflow = "hidden";
  }
  const coverMover = inner ? (cover.firstElementChild as HTMLElement | null) ?? cover : cover;
  if (inner && innerBox) {
    // The old date's copy shows only what was on screen, so the rest of it doesn't lie over the new one.
    const top = box.top - innerBox.top, bottom = innerBox.bottom - box.bottom;
    Object.assign(coverMover.style, { willChange: "transform", clipPath: `inset(${Math.max(0, top)}px 0 ${Math.max(0, bottom)}px 0)` });
  }
  main.appendChild(cover);
  // A date's header stays as it was until the turn is over.
  const held = head && headBox ? copyOf(head, headBox, frameBox, { zIndex: "3", background: "hsl(var(--background))" }) : undefined;
  if (held) main.appendChild(held);
  const moving = inner ?? body;
  const s: TurnState = {
    main, cover, coverMover, dir, mode, axis, size: axis === "y" ? box.height : box.width, held, pos: 0, fade: 0, t: "none",
    styled: new Set(), from: moving, clip: inner ? body : undefined, scrolled,
    // A page is the one in `main` now; a date's content stays the same element as it changes.
    moving: mode === "page" ? () => main.querySelector<HTMLElement>(":scope > [data-page]") : () => moving,
    look: mode === "page"
      ? { position: "relative", zIndex: "1", background: "hsl(var(--background))", boxShadow: under ? SHADOW : "none", willChange: "transform, opacity" }
      : inner ? { willChange: "transform", clipPath: `inset(0 0 calc(100% - ${view}px) 0)` } : { willChange: "transform" },
    // The new page, as React swaps it in, goes straight to where the old one was (before it's drawn).
    watch: new MutationObserver(() => place(s)),
  };
  s.watch.observe(main, { childList: true });
  frame(s, 0);
  return s;
}

/** Puts the turn `p` of the way along (0 to 1), easing there over `ms`. */
export function frame(s: TurnState, p: number, ms = 0) {
  const { coverMover, dir, size } = s;
  let coverPos: number, pagePos: number;
  if (s.mode === "date") {
    // Side by side, as one long page: the next date comes in right behind the last.
    coverPos = -dir * size * p;
    pagePos = dir * size * (1 - p);
  } else if (dir > 0) {
    coverPos = -size * p;
    pagePos = 0.3 * size * (1 - p);
  } else {
    coverPos = 0.3 * size * p;
    pagePos = -size * (1 - p);
  }
  const move = ms ? `transform ${ms}ms ${EASE}` : "none";
  coverMover.style.transition = move;
  coverMover.style.transform = shift(s.axis, coverPos);
  s.pos = pagePos;
  s.fade = Math.min(1, p / FADE_BY);
  s.t = ms && s.mode === "page" ? `${move}, opacity ${Math.round(ms * FADE_BY)}ms linear` : move;
  place(s);
}

/** Finishes the turn (or, `done` false, puts it back and calls `undo`), then tidies up. */
export function endTurn(s: TurnState, done: boolean, ms: number, undo?: () => void) {
  frame(s, done ? 1 : 0, ms);
  setTimeout(() => {
    if (!done) {
      quietUntil = performance.now() + 600;
      undo?.();
    }
    // Back to as it was once an undone page is drawn under the copy.
    setTimeout(() => {
      s.watch.disconnect();
      s.cover.remove();
      s.held?.remove();
      if (s.clip) {
        s.clip.style.overflow = "";
        // Taken back, the old date is where it was scrolled to.
        if (!done) s.clip.scrollTop = s.scrolled ?? 0;
      }
      for (const el of s.styled) for (const k of MOVED) el.style[k] = "";
      busy = false;
    }, done ? 0 : 80);
  }, ms + 20);
}

/** A whole turn on its own, for a change already being made (a tap, a link). */
function playTurn(main: HTMLElement, page: HTMLElement, dir: 1 | -1, mode: TurnMode) {
  if (busy || reduced()) return;
  const s = startTurn(main, page, dir, mode);
  // Drawn at the start for a frame, then eased through, once the new page is in if it's soon (React
  // may take a few frames to draw it; it fades in either way). A date changes in place.
  let frames = 0;
  const go = () => {
    if (mode === "page" && s.moving() === page && ++frames < 6) return requestAnimationFrame(go);
    requestAnimationFrame(() => endTurn(s, true, 300));
  };
  requestAnimationFrame(go);
}

/**
 * Turns for changes made by tapping, not dragging: any move between pages in the bar, or to another
 * date of the same page (the arrows, a day in the month, Today). Called as the address changes, before
 * the new page is drawn, so the old one can still be copied.
 */
let order: { match: (loc: string) => boolean }[] = [];
export function setTurnOrder(pages: { match: (loc: string) => boolean }[]) { order = pages; }
const pathOf = (url: string) => "/" + (new URL(url).hash.replace(/^#?\/?/, "").split("?")[0]);
/** The page in the bar that a path is on (-1 for none, like Settings). */
export const pageOf = (path: string) => order.findIndex((n) => n.match(path));
const dateOf = (path: string) => /\d{4}-\d{2}-\d{2}/.exec(path)?.[0];

function onAddress(e: Event) {
  if (busy || performance.now() < quietUntil) return;
  const { oldURL, newURL } = e as HashChangeEvent;
  if (!oldURL || !newURL) return;
  const from = pathOf(oldURL), to = pathOf(newURL);
  if (from === to) return;
  const a = pageOf(from), b = pageOf(to);
  const main = document.querySelector<HTMLElement>("main[data-pages]"), page = main?.querySelector<HTMLElement>("[data-page]");
  if (!main || !page || a < 0 || b < 0) return;
  if (a !== b) return playTurn(main, page, b > a ? 1 : -1, "page");
  // The same page on another date: later dates come from the right. ("/" is today.)
  const today = new Date(), ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const d1 = dateOf(from) ?? ymd, d2 = dateOf(to) ?? ymd;
  if (d1 !== d2) playTurn(main, page, d2 > d1 ? 1 : -1, "date");
}
// Before the router's own listener (which draws the new page), so this one sees the old page.
window.addEventListener("hashchange", onAddress);

/**
 * The date arrows (marked data-swipe) turn the date as they're pressed, whether the date is in the
 * address (Today, the journal: then onAddress sees a turn under way and leaves it) or kept by the page
 * (the calendar's weeks and months). A drag pressing one is already turning, so nothing more happens.
 */
document.addEventListener("click", (e) => {
  const step = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-swipe]");
  if (!step || busy || reduced()) return;
  const main = step.closest<HTMLElement>("main[data-pages]"), page = main?.querySelector<HTMLElement>("[data-page]");
  if (main && page) playTurn(main, page, step.dataset.swipe === "next" ? 1 : -1, "date");
}, true);
