// Pure helpers for local entries and the outbox. No I/O, so they are unit-tested.
import { applyResult, type SrsState } from "@learning-log/core";
import { type Entry, type Grade, type Op, SERVER_FIELDS } from "./types";

// ------------------------------------------------------------------ queries

export function visibleEntries(entries: Record<string, Entry>): Entry[] {
  return Object.values(entries).filter((e) => !e.deleted_at);
}

/** Entries due for review at `now`, oldest due first. Mastered entries are never due. */
export function dueEntries(entries: Record<string, Entry>, now: Date): Entry[] {
  return visibleEntries(entries)
    .filter((e) => e.status !== "Mastered" && e.next_review !== null && Date.parse(e.next_review) <= now.getTime())
    .sort((a, b) => Date.parse(a.next_review!) - Date.parse(b.next_review!));
}

/** Entries due before the end of the user's local day (for the Home "due today" count). */
export function dueToday(entries: Record<string, Entry>, endOfLocalDay: Date): Entry[] {
  return dueEntries(entries, endOfLocalDay);
}

export function endOfLocalDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

export interface BrowseFilter {
  query?: string;
  status?: Entry["status"] | "All";
  category?: string | "All";
}

export function searchEntries(entries: Record<string, Entry>, f: BrowseFilter): Entry[] {
  const q = (f.query ?? "").trim().toLowerCase();
  return visibleEntries(entries)
    .filter((e) => (f.status && f.status !== "All" ? e.status === f.status : true))
    .filter((e) => (f.category && f.category !== "All" ? e.category === f.category : true))
    .filter((e) => {
      if (!q) return true;
      return [e.topic, e.key_idea, e.raw_text, e.category, e.apply_it].some((t) => (t ?? "").toLowerCase().includes(q));
    })
    .sort((a, b) => Date.parse(b.learned_at) - Date.parse(a.learned_at));
}

export function categoriesOf(entries: Record<string, Entry>): string[] {
  const set = new Set<string>();
  for (const e of visibleEntries(entries)) if (e.category) set.add(e.category);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** The question to show: the AI-made variant if there is one, else the original. */
export function currentQuestion(e: Entry): string {
  return e.next_question || e.recall_question || (e.topic ? `What do you remember about "${e.topic}"?` : "What do you remember about this note?");
}

export function titleOf(e: Entry): string {
  return e.topic || e.raw_text.trim().split("\n")[0]?.slice(0, 80) || "Untitled note";
}

// ------------------------------------------------------------------ local review

export function toSrs(e: Entry): SrsState {
  return {
    status: e.status,
    streakCorrect: e.streak_correct,
    timesReviewed: e.times_reviewed,
    lastResult: e.last_result,
    nextReview: e.next_review ? new Date(e.next_review) : null,
    lastReviewedAt: e.last_reviewed_at ? new Date(e.last_reviewed_at) : null,
  };
}

/** Optimistic local review (offline self-grade). The server recomputes with the same function on sync. */
export function reviewedEntry(e: Entry, grade: Grade, now: Date): Entry {
  const s = applyResult(toSrs(e), grade, now).state;
  return {
    ...e,
    status: s.status,
    streak_correct: s.streakCorrect,
    times_reviewed: s.timesReviewed,
    last_result: s.lastResult,
    next_review: s.nextReview ? s.nextReview.toISOString() : null,
    last_reviewed_at: s.lastReviewedAt ? s.lastReviewedAt.toISOString() : null,
  };
}

// ------------------------------------------------------------------ sync: merge

export interface PendingInfo {
  /** An unsent create/update for this entry exists: keep the local text. */
  content: boolean;
  /** An unsent review for this entry exists: keep the local schedule. */
  review: boolean;
}

export function pendingFor(outbox: Op[], entryId: string): PendingInfo {
  return {
    content: outbox.some((o) => (o.kind === "entry_create" || o.kind === "entry_update") && o.entryId === entryId),
    review: outbox.some((o) => o.kind === "review" && o.entryId === entryId),
  };
}

/**
 * Merge a server row into local state. Returns null when the entry should be removed locally.
 * Local unsent edits win over server text (last-write-wins per row); the server's review state wins
 * unless a review is still waiting to be sent.
 */
export function mergeServerEntry(local: Entry | undefined, server: Entry, pending: PendingInfo): Entry | null {
  if (server.deleted_at) return pending.content ? local ?? null : null;
  if (!local) return server;

  let merged: Entry = pending.content ? { ...server, ...pick(local, contentKeys(local)) } : { ...server };
  if (pending.review) merged = { ...merged, ...pick(local, SERVER_FIELDS) };
  return merged;
}

function contentKeys(e: Entry): (keyof Entry)[] {
  return (Object.keys(e) as (keyof Entry)[]).filter((k) => !(SERVER_FIELDS as readonly string[]).includes(k) && k !== "id");
}

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

// ------------------------------------------------------------------ sync: outbox

/** Add an entry edit to the outbox, folding it into an unsent create/update of the same entry. */
export function enqueueEntryPatch(outbox: Op[], entryId: string, patch: Record<string, unknown>, newOpId: string): Op[] {
  const i = outbox.findIndex((o) => (o.kind === "entry_create" || o.kind === "entry_update") && o.entryId === entryId);
  const existing = i >= 0 ? outbox[i] : undefined;
  if (existing?.kind === "entry_create") {
    const next = [...outbox];
    next[i] = { ...existing, row: { ...existing.row, ...patch } };
    return next;
  }
  if (existing?.kind === "entry_update") {
    const next = [...outbox];
    next[i] = { ...existing, patch: { ...existing.patch, ...patch } };
    return next;
  }
  return [...outbox, { id: newOpId, kind: "entry_update", entryId, patch }];
}
