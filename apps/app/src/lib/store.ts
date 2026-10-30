// Local-first state. Everything the user does is applied here immediately and queued in the outbox;
// the sync engine (sync.ts) sends it when online. Persisted per user so the app works offline.
import { localDate, recordReviewDay } from "@learning-log/core";
import { randomUUID } from "expo-crypto";
import { create } from "zustand";
import type { Quota, ReviewState } from "./api";
import { enqueueEntryPatch, pendingFor, reviewedEntry } from "./entries";
import { kv } from "./storage";
import { CONTENT_FIELDS, type Entry, type Grade, type Op, type Profile, type SourceType } from "./types";

export type ThemePref = "system" | "light" | "dark";
export type SyncStatus = "idle" | "syncing" | "offline" | "error";

interface Persisted {
  entries: Record<string, Entry>;
  outbox: Op[];
  profile: Profile | null;
  lastPulledAt: string | null;
}

interface State extends Persisted {
  hydrated: boolean;
  userId: string | null;
  theme: ThemePref;
  sync: { status: SyncStatus; lastSyncedAt: string | null; error: string | null };
  quota: Quota | null;

  hydrate(userId: string): Promise<void>;
  clear(): void;
  setProfile(p: Profile): void;
  setTheme(t: ThemePref): void;
  setSync(s: Partial<State["sync"]>): void;
  setQuota(q: Quota | undefined | null): void;

  createEntry(input: { raw_text: string; source_url?: string | null; source_type?: SourceType }): Entry;
  patchEntry(id: string, patch: Partial<Pick<Entry, (typeof CONTENT_FIELDS)[number]>>): void;
  removeEntry(id: string): void;
  recordSelfReview(id: string, grade: Grade, question: string, answer?: string): void;
  applyServerReview(r: ReviewState): void;
}

/** Set by sync.ts so the store can ask for a sync without importing it (avoids a cycle). */
export const hooks = { syncSoon: () => {} };

const emptyData: Persisted = { entries: {}, outbox: [], profile: null, lastPulledAt: null };
const dataKey = (userId: string) => `ll:v1:${userId}`;
const THEME_KEY = "ll:theme";

let persistTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => {
  const mutate = (fn: (s: State) => Partial<State>) => {
    set(fn);
    hooks.syncSoon();
  };

  return {
    ...emptyData,
    hydrated: false,
    userId: null,
    theme: "system",
    sync: { status: "idle", lastSyncedAt: null, error: null },
    quota: null,

    async hydrate(userId) {
      let data = emptyData;
      try {
        const raw = await kv.get(dataKey(userId));
        if (raw) data = { ...emptyData, ...JSON.parse(raw) };
      } catch { /* corrupt or blocked storage: start fresh, the server is the source of truth */ }
      set({ ...data, userId, hydrated: true });
    },

    clear() {
      const { userId } = get();
      if (persistTimer) clearTimeout(persistTimer);
      if (userId) void kv.del(dataKey(userId));
      set({ ...emptyData, userId: null, hydrated: false, quota: null, sync: { status: "idle", lastSyncedAt: null, error: null } });
    },

    setProfile: (profile) => set({ profile }),
    setTheme(theme) {
      set({ theme });
      void kv.set(THEME_KEY, theme);
    },
    setSync: (s) => set((st) => ({ sync: { ...st.sync, ...s } })),
    setQuota: (q) => q && set({ quota: q }),

    createEntry({ raw_text, source_url, source_type }) {
      const now = new Date();
      const nowIso = now.toISOString();
      const entry: Entry = {
        id: randomUUID(),
        source_type: source_type ?? (source_url ? "url" : "text"),
        source_url: source_url?.trim() || null,
        raw_text: raw_text.trim(),
        topic: null,
        key_idea: null,
        recall_question: null,
        next_question: null,
        apply_it: null,
        category: null,
        language: null,
        structure_state: "raw",
        status: "New",
        next_review: new Date(now.getTime() + 86_400_000).toISOString(),
        times_reviewed: 0,
        streak_correct: 0,
        last_result: null,
        last_reviewed_at: null,
        learned_at: nowIso,
        client_updated_at: nowIso,
        deleted_at: null,
      };
      const row: Record<string, unknown> = { id: entry.id };
      for (const k of CONTENT_FIELDS) row[k] = entry[k];
      mutate((s) => ({
        entries: { ...s.entries, [entry.id]: entry },
        outbox: [...s.outbox, { id: randomUUID(), kind: "entry_create", entryId: entry.id, row }],
      }));
      return entry;
    },

    patchEntry(id, patch) {
      const existing = get().entries[id];
      if (!existing) return;
      const full = { ...patch, client_updated_at: new Date().toISOString() };
      mutate((s) => ({
        entries: { ...s.entries, [id]: { ...existing, ...full } },
        outbox: enqueueEntryPatch(s.outbox, id, full, randomUUID()),
      }));
    },

    removeEntry(id) {
      get().patchEntry(id, { deleted_at: new Date().toISOString() });
    },

    recordSelfReview(id, grade, question, answer) {
      const existing = get().entries[id];
      if (!existing) return;
      const now = new Date();
      const op: Op = {
        id: randomUUID(),
        kind: "review",
        entryId: id,
        payload: {
          review_id: randomUUID(),
          entry_id: id,
          grade,
          question,
          ...(answer ? { answer } : {}),
          reviewed_at: now.toISOString(),
        },
      };
      mutate((s) => {
        const p = s.profile;
        const profile = p
          ? (() => {
            const next = recordReviewDay(
              { current: p.streak_current, best: p.streak_best, lastDate: p.last_review_date },
              localDate(now, p.timezone),
            );
            return { ...p, streak_current: next.current, streak_best: next.best, last_review_date: next.lastDate };
          })()
          : p;
        return {
          entries: { ...s.entries, [id]: reviewedEntry(existing, grade, now) },
          outbox: [...s.outbox, op],
          profile,
        };
      });
    },

    applyServerReview(r) {
      set((s) => {
        const local = s.entries[r.entry.id];
        const stillPending = pendingFor(s.outbox, r.entry.id).review;
        const entries = !local || stillPending
          ? s.entries
          : { ...s.entries, [local.id]: { ...local, ...r.entry } };
        const profile = s.profile && !s.outbox.some((o) => o.kind === "review")
          ? { ...s.profile, streak_current: r.streak.current, streak_best: r.streak.best }
          : s.profile;
        return { entries, profile };
      });
    },
  };
});

// ---------------------------------------------------------------- persistence

useStore.subscribe((state, prev) => {
  if (!state.hydrated || !state.userId) return;
  const changed = state.entries !== prev.entries || state.outbox !== prev.outbox ||
    state.profile !== prev.profile || state.lastPulledAt !== prev.lastPulledAt;
  if (!changed) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const s = useStore.getState();
    if (!s.userId) return;
    const data: Persisted = { entries: s.entries, outbox: s.outbox, profile: s.profile, lastPulledAt: s.lastPulledAt };
    void kv.set(dataKey(s.userId), JSON.stringify(data));
  }, 250);
});

void kv.get(THEME_KEY).then((t) => {
  if (t === "light" || t === "dark" || t === "system") useStore.setState({ theme: t });
}).catch(() => {});
