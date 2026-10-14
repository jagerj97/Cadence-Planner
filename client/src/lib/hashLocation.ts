import { startTransition, useEffect, useRef, useState } from "react";
import { navigate } from "wouter/use-hash-location";
import { pageOf } from "@/components/pageTurn";

const current = () => "/" + location.hash.replace(/^#?\/?/, "").split("?")[0];

/**
 * The address (after the #) for the router, like wouter's own hash location, except that moving to
 * another page is drawn as a transition: React draws the new page a little at a time, between frames,
 * so a swipe or a page turn keeps moving while it's drawn (pageTurn shows it once it's in). Another
 * date of the same page changes at once, as it slides in beside the last.
 */
export function useTransitionHashLocation(): [string, typeof navigate] {
  const [loc, setLoc] = useState(current);
  const last = useRef(loc);
  useEffect(() => {
    const update = () => {
      const next = current(), was = last.current;
      if (next === was) return;
      last.current = next;
      const a = pageOf(was), b = pageOf(next);
      if (a >= 0 && b >= 0 && a !== b) startTransition(() => setLoc(next));
      else setLoc(next);
    };
    addEventListener("hashchange", update);
    addEventListener("popstate", update);
    return () => {
      removeEventListener("hashchange", update);
      removeEventListener("popstate", update);
    };
  }, []);
  return [loc, navigate];
}
/** Links' addresses, as with wouter's hash location. */
useTransitionHashLocation.hrefs = (href: string) => "#" + href;
