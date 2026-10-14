/**
 * Page turns: how one page (or one date of a page) gives way to the next, whether dragged, tapped or
 * navigated to. The page to the left always lies on top of the one to its right:
 * - going to the next page, the old one slides off to the left, uncovering the new one beneath, which
 *   drifts over from the right;
 * - going back, the new one slides in over the old from the left, the old drifting off to the right.
 * A date changes as if the days (weeks, months) were one long page: only the page's content (marked
 * data-turn-body) slides along, the next date's right beside the last. Its header (data-turn-head,
 * with the date) is held as it was until the new date has slid all the way in, then updates.
 *
 * The old page (or content) is a copy laid over `main` (which can't be tapped); the real one moves
 * through CSS variables on `main` (see `main[data-turn]` in index.css), so a page React swaps in
 * mid-turn picks up where the last one was instead of flashing in.
 */

import { reducedMotion as reduced } from "./motion";

export type TurnMode = "page" | "date";
export type TurnState = { main: HTMLElement; cover: HTMLElement; dir: 1 | -1; mode: TurnMode; w: number; marked?: HTMLElement; held?: HTMLElement };

const EASE = "cubic-bezier(.2,.7,.3,1)";
const SHADOW = "0 0 32px 2px rgb(0 0 0 / .45)";

/** Whether a turn is under way (or settling): another can't start, and navigating doesn't add one. */
let busy = false;
export const turning = () => busy;
/** Until when an address change is a drag being taken back (history.back() arrives later), not a new turn. */
let quietUntil = 0;

/** Gives a copied page the scroll positions of the original (copies start scrolled to the top). */
function copyScroll(from: Element, to: Element) {
  // Only what can scroll (the copy has the same elements in the same order), not every element.
  const sel = '[class*="overflow-"]';
  const a = [from, ...from.querySelectorAll(sel)], b = [to, ...to.querySelectorAll(sel)];
  a.forEach((x, n) => {
    const y = b[n];
    if (y && (x.scrollTop || x.scrollLeft)) { y.scrollTop = x.scrollTop; y.scrollLeft = x.scrollLeft; }
  });
}

/** A still copy of `el` laid over it in `main` (it can't be tapped), so it looks unchanged while the real one updates. */
function hold(main: HTMLElement, el: HTMLElement, z: string) {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  copy.querySelectorAll("[data-testid]").forEach((n) => n.removeAttribute("data-testid"));
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  copy.classList.add("page-cover");
  const box = el.getBoundingClientRect(), frameBox = main.getBoundingClientRect();
  Object.assign(copy.style, {
    position: "absolute", left: `${box.left - frameBox.left}px`, top: `${box.top - frameBox.top}px`, width: `${box.width}px`,
    height: `${box.height}px`, margin: "0", zIndex: z, pointerEvents: "none", background: "hsl(var(--background))",
  });
  main.appendChild(copy);
  return copy;
}

/** Lays a copy of `page` over `main`, and sets the turn going with nothing moved yet. */
export function startTurn(main: HTMLElement, page: HTMLElement, dir: 1 | -1, mode: TurnMode): TurnState {
  busy = true;
  // A date moves only the page's content; a page without it marked moves whole.
  let moving = page, marked: HTMLElement | undefined;
  if (mode === "date") {
    moving = page.querySelector<HTMLElement>("[data-turn-body]") ?? page;
    if (moving === page) { page.setAttribute("data-turn-body", ""); marked = page; }
  }
  const cover = moving.cloneNode(true) as HTMLElement;
  cover.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  cover.querySelectorAll("[data-testid]").forEach((el) => el.removeAttribute("data-testid"));
  cover.removeAttribute("data-page");
  cover.setAttribute("aria-hidden", "true");
  cover.inert = true;
  cover.classList.add("page-cover");
  // Going back, the old page lies under the new one; otherwise on top. Dates sit side by side.
  const under = mode === "page" && dir < 0;
  const box = moving.getBoundingClientRect(), frameBox = main.getBoundingClientRect();
  Object.assign(cover.style, {
    position: "absolute", left: `${box.left - frameBox.left}px`, top: `${box.top - frameBox.top}px`, width: `${box.width}px`,
    height: `${box.height}px`, margin: "0", zIndex: under ? "0" : "2", pointerEvents: "none",
    background: mode === "date" ? "transparent" : "hsl(var(--background))",
    boxShadow: mode === "page" && !under ? SHADOW : "none",
  });
  main.appendChild(cover);
  copyScroll(moving, cover);
  // A date's header stays as it was until the turn is over.
  const head = mode === "date" ? page.querySelector<HTMLElement>("[data-turn-head]") : null;
  const held = head ? hold(main, head, "3") : undefined;
  const s: TurnState = { main, cover, dir, mode, w: box.width, marked, held };
  main.dataset.turn = mode;
  main.style.setProperty("--turn-shadow", under ? SHADOW : "none");
  frame(s, 0);
  return s;
}

/** Puts the turn `p` of the way along (0 to 1), easing there over `ms`. */
export function frame(s: TurnState, p: number, ms = 0) {
  const { main, cover, dir, w } = s;
  const t = ms ? `transform ${ms}ms ${EASE}, opacity ${ms}ms ${EASE}` : "none";
  let coverX: number, pageX: number;
  if (s.mode === "date") {
    // Side by side, as one long page: the next date comes in right behind the last.
    coverX = -dir * w * p;
    pageX = dir * w * (1 - p);
  } else if (dir > 0) {
    coverX = -w * p;
    pageX = 0.3 * w * (1 - p);
  } else {
    coverX = 0.3 * w * p;
    pageX = -w * (1 - p);
  }
  cover.style.transition = t;
  cover.style.transform = `translateX(${coverX}px)`;
  main.style.setProperty("--turn-t", t);
  main.style.setProperty("--turn-x", `${pageX}px`);
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
      s.cover.remove();
      s.held?.remove();
      s.marked?.removeAttribute("data-turn-body");
      delete s.main.dataset.turn;
      for (const v of ["--turn-t", "--turn-x", "--turn-shadow"]) s.main.style.removeProperty(v);
      busy = false;
    }, done ? 0 : 80);
  }, ms + 20);
}

/** A whole turn on its own, for a change already being made (a tap, a link). */
export function playTurn(main: HTMLElement, page: HTMLElement, dir: 1 | -1, mode: TurnMode) {
  if (busy || reduced()) return;
  const s = startTurn(main, page, dir, mode);
  // Drawn at the start for a frame, then eased through once the new page is in.
  requestAnimationFrame(() => requestAnimationFrame(() => endTurn(s, true, 300)));
}

/**
 * Turns for changes made by tapping, not dragging: any move between pages in the bar, or to another
 * date of the same page (the arrows, a day in the month, Today). Called as the address changes, before
 * the new page is drawn, so the old one can still be copied.
 */
let order: { match: (loc: string) => boolean }[] = [];
export function setTurnOrder(pages: { match: (loc: string) => boolean }[]) { order = pages; }
const pathOf = (url: string) => "/" + (new URL(url).hash.replace(/^#?\/?/, "").split("?")[0]);
const dateOf = (path: string) => /\d{4}-\d{2}-\d{2}/.exec(path)?.[0];

function onAddress(e: Event) {
  if (busy || performance.now() < quietUntil) return;
  const { oldURL, newURL } = e as HashChangeEvent;
  if (!oldURL || !newURL) return;
  const from = pathOf(oldURL), to = pathOf(newURL);
  if (from === to) return;
  const a = order.findIndex((n) => n.match(from)), b = order.findIndex((n) => n.match(to));
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
