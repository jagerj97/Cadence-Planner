import { Fragment, type ReactNode } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Links in text open in the browser, and a location opens the phone's maps app. On Android the app
 * hands both on to the system (AppActivity's shouldOverrideUrlLoading): web links to the browser, and
 * geo: links to the default navigation app. The web version links to Google Maps instead.
 */

const URL_PART = /((?:https?:\/\/|www\.)[^\s<>"]+)/gi;

/** A link as written, minus punctuation that ends the sentence around it ("see example.com/x."). */
function trimUrl(raw: string) {
  let url = raw.replace(/[.,;:!?'"]+$/, "");
  // A closing bracket belongs to the link only if it opened one too.
  while (/[)\]]$/.test(url) && (url.match(/[(\[]/g)?.length ?? 0) < (url.match(/[)\]]/g)?.length ?? 0)) url = url.slice(0, -1);
  return url;
}

const hrefOf = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

export const hasLink = (text: string) => new RegExp(URL_PART.source, "i").test(text);

/** Text with its links tappable; `rest` draws the text between them (formatting, #tags). */
export function Linked({ text, rest = (t) => t }: { text: string; rest?: (text: string) => ReactNode }) {
  const parts = text.split(URL_PART);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part && rest(part)}</Fragment>;
        const url = trimUrl(part);
        return (
          <Fragment key={i}>
            <a href={hrefOf(url)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              className="text-primary underline underline-offset-2 [overflow-wrap:anywhere]" data-testid="link-url">
              {url}
            </a>
            {part.slice(url.length) && rest(part.slice(url.length))}
          </Fragment>
        );
      })}
    </>
  );
}

declare global {
  interface Window { cadenceWeb?: boolean }
}

/** Where a place opens: the phone's default maps or navigation app (geo:), or Google Maps on the web. */
export const mapsHref = (place: string) =>
  window.cadenceWeb ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : `geo:0,0?q=${encodeURIComponent(place)}`;

/** An item's location: a link opens as a link (a video call, say); a place opens in maps. */
export function LocationLink({ location, className }: { location: string; className?: string }) {
  if (hasLink(location)) return <span className={cn("break-words", className)}><Linked text={location} /></span>;
  return (
    <a href={mapsHref(location)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
      className={cn("inline-flex max-w-full items-start gap-1.5 text-primary underline-offset-2 hover:underline", className)}
      aria-label={`${location}, open in maps`} data-testid="link-location">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="break-words">{location}</span>
    </a>
  );
}
