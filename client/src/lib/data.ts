import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "./queryClient";
import type { Item, InsertItem, Feed, Session, Settings } from "@shared/schema";
import { DEFAULT_SETTINGS } from "@shared/schema";
import { haptic } from "./haptics";
import { setTagColors, todayStr } from "./cal";

export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

export function useItems() {
  return useQuery<Item[]>({ queryKey: ["/api/items"] });
}
export function useSettings() {
  const q = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const settings = q.data ?? DEFAULT_SETTINGS;
  setTagColors(settings.taskTags);
  return { ...q, settings };
}
export function useFeeds() {
  return useQuery<Feed[]>({ queryKey: ["/api/feeds"] });
}
export function useSessions() {
  return useQuery<Session[]>({ queryKey: ["/api/sessions"] });
}
export function useDeleteSession() {
  return useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/sessions/${id}`),
    // A session saved to the calendar takes its item and journal entry with it.
    onSuccess: () => ["/api/sessions", "/api/items", "/api/journal"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  });
}

const invItems = () => queryClient.invalidateQueries({ queryKey: ["/api/items"] });
// An item's notes are mirrored in the journal (androidApi.ts), so saving either refreshes both.
// Deleting an item also deletes a focus session saved as it, so sessions refresh too.
const inv = () => Promise.all([invItems(), ...["/api/journal", "/api/sessions"].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))]);

export function useItemMutations() {
  const create = useMutation({
    mutationFn: async (d: InsertItem) => (await apiRequest("POST", "/api/items", d)).json() as Promise<Item>,
    onSuccess: inv,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...d }: Partial<InsertItem> & { id: number }) =>
      (await apiRequest("PATCH", `/api/items/${id}`, d)).json() as Promise<Item>,
    onSuccess: inv,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/items/${id}`),
    onSuccess: inv,
  });
  const toggle = useMutation({
    mutationFn: async ({ id, date }: { id: number; date: string }) =>
      (await apiRequest("POST", `/api/items/${id}/toggle`, { date })).json() as Promise<Item>,
    onMutate: async ({ id, date }) => {
      // optimistic
      const prev = queryClient.getQueryData<Item[]>(["/api/items"]);
      if (prev) {
        queryClient.setQueryData<Item[]>(
          ["/api/items"],
          prev.map((i) => {
            if (i.id !== id) return i;
            const s = new Set<string>(JSON.parse(i.completions || "[]"));
            haptic(s.has(date) ? "tick" : "complete");
            s.has(date) ? s.delete(date) : s.add(date);
            s.delete(date + "~h");
            return { ...i, completions: JSON.stringify([...s]) };
          }),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && queryClient.setQueryData(["/api/items"], ctx.prev),
    onSettled: invItems,
  });
  const cycle = useMutation({
    mutationFn: async ({ id, date }: { id: number; date: string }) =>
      (await apiRequest("POST", `/api/items/${id}/cycle`, { date })).json() as Promise<Item>,
    onMutate: async ({ id, date }) => {
      const prev = queryClient.getQueryData<Item[]>(["/api/items"]);
      if (prev) {
        queryClient.setQueryData<Item[]>(
          ["/api/items"],
          prev.map((i) => {
            if (i.id !== id) return i;
            const s = new Set<string>(JSON.parse(i.completions || "[]"));
            // Habits cycle: empty → partly done → done → empty.
            haptic(s.has(date + "~h") ? "complete" : "tick");
            if (s.has(date)) s.delete(date);
            else if (s.has(date + "~h")) {
              s.delete(date + "~h");
              s.add(date);
            } else s.add(date + "~h");
            return { ...i, completions: JSON.stringify([...s]) };
          }),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && queryClient.setQueryData(["/api/items"], ctx.prev),
    onSettled: invItems,
  });
  const skip = useMutation({
    mutationFn: async ({ id, date }: { id: number; date: string }) => apiRequest("POST", `/api/items/${id}/skip`, { date }),
    onSuccess: invItems,
  });
  // Renames a task tag on every task that has it, or removes it (to: null), in one pass.
  const retag = useMutation({
    mutationFn: async (d: { from: string; to: string | null }) => apiRequest("POST", "/api/items/retag", d),
    onSuccess: invItems,
  });
  return { create, update, remove, toggle, cycle, skip, retag };
}

export function useSaveSettings() {
  return useMutation({
    mutationFn: async (s: Partial<Settings>) => (await apiRequest("PUT", "/api/settings", s)).json() as Promise<Settings>,
    onSuccess: (d) => queryClient.setQueryData(["/api/settings"], d),
  });
}

export function blankItem(partial: Partial<InsertItem>): InsertItem {
  return {
    title: "",
    kind: "event",
    date: todayStr(),
    endDate: null,
    availableFrom: null,
    startTime: null,
    endTime: null,
    allDay: false,
    notes: "",
    location: "",
    color: null,
    recurrence: '{"freq":"none"}',
    exceptions: "[]",
    completions: "[]",
    reminder: DEFAULT_SETTINGS.defaultReminder,
    extraReminders: "[]",
    priority: "normal",
    autoTimer: false,
    source: "local",
    uid: null,
    ...partial,
  };
}

/* ---------- journal ---------- */
import type { JournalEntry } from "@shared/schema";
export function useJournal() {
  return useQuery<JournalEntry[]>({ queryKey: ["/api/journal"] });
}
export function useJournalMutations() {
  const create = useMutation({
    mutationFn: async (d: { date: string; title?: string | null; body: string; tags: string[]; hashtags?: boolean }) => (await apiRequest("POST", "/api/journal", d)).json() as Promise<JournalEntry>,
    onSuccess: inv,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...d }: { id: number; title?: string | null; body?: string; tags?: string[]; date?: string; hashtags?: boolean; archived?: boolean }) =>
      (await apiRequest("PATCH", `/api/journal/${id}`, d)).json() as Promise<JournalEntry>,
    onSuccess: inv,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/journal/${id}`),
    onSuccess: inv,
  });
  // Renames a journal tag, or removes it (to: null), across every entry.
  const retag = useMutation({
    mutationFn: async (d: { from: string; to: string | null }) => apiRequest("POST", "/api/journal/retag", d),
    onSuccess: inv,
  });
  return { create, update, remove, retag };
}
export { hashtagsIn } from "@shared/schema";
