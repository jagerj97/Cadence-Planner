import { useState } from "react";
import { useSaveSettings, useSettings } from "@/lib/data";
import { APP_VERSION, CHANGELOG } from "@/lib/changelog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The first time the app opens after an update: the version and quick notes on what changed.
 * Dismissing it remembers the version (Settings.seenVersion), so it's back only after the next update.
 */
export function WhatsNew() {
  const { data: saved } = useSettings();
  const save = useSaveSettings();
  const [closed, setClosed] = useState(false);
  const open = !closed && !!saved && APP_VERSION !== "dev" && saved.seenVersion !== APP_VERSION;
  const dismiss = () => {
    setClosed(true);
    save.mutate({ seenVersion: APP_VERSION });
  };
  const notes = CHANGELOG[APP_VERSION] ?? { changes: ["Fixes and improvements."] };
  const sections = [["Fixes", notes.fixes], ["Changes", notes.changes]] as const;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto" data-testid="dialog-whats-new">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-base leading-snug">v{APP_VERSION} — What's new</DialogTitle>
          <DialogDescription className="sr-only">What changed in this update</DialogDescription>
        </DialogHeader>
        {sections.map(([heading, list]) => !!list?.length && (
          <section key={heading} className="grid gap-2" data-testid={`section-whats-new-${heading.toLowerCase()}`}>
            <h3 className="text-sm font-semibold">{heading}</h3>
            <ul className="grid gap-2 pl-5 text-sm list-disc marker:text-primary">
              {list.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
