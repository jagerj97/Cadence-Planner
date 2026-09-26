import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "./queryClient";
import type { Item, InsertItem, Feed, Session, Settings } from "@shared/schema";
import { DEFAULT_SETTINGS } from "@shared/schema";
import { haptic } from "./haptics";

export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

export function useItems() {
  return useQuery<Item[]>({ queryKey: ["/api/items"] });
}
export function useSettings() {
  const q = useQuery<Settings>({ queryKey: ["/api/settings"] });
  return { ...q, settings: q.data ?? DEFAULT_SETTINGS };
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/sessions"] }),
  });
}

const invItems = () => queryClient.invalidateQueries({ queryKey: ["/api/items"] });
// An item's notes are mirrored in the journal (androidApi.ts), so saving either refreshes both.
const inv = () => Promise.all([invItems(), queryClient.invalidateQueries({ queryKey: ["/api/journal"] })]);

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
    date: new Date().toISOString().slice(0, 10),
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
    reminder: 10,
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
    mutationFn: async (d: { date: string; body: string; tags: string[] }) => (await apiRequest("POST", "/api/journal", d)).json() as Promise<JournalEntry>,
    onSuccess: inv,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...d }: { id: number; body?: string; tags?: string[]; date?: string }) =>
      (await apiRequest("PATCH", `/api/journal/${id}`, d)).json() as Promise<JournalEntry>,
    onSuccess: inv,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/journal/${id}`),
    onSuccess: inv,
  });
  return { create, update, remove };
}
export const tagsOf = (e: { tags: string }): string[] => {
  try {
    return JSON.parse(e.tags || "[]");
  } catch {
    return [];
  }
};
export const hashtagsIn = (body: string) => [...body.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[2].toLowerCase());
