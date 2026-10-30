import { describe, expect, it } from "vitest";
import {
  currentQuestion, dueEntries, enqueueEntryPatch, mergeServerEntry, pendingFor, reviewedEntry, searchEntries, titleOf,
} from "./entries";
import type { Entry, Op } from "./types";

const NOW = new Date("2026-10-30T09:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: "e1", source_type: "text", source_url: null, raw_text: "raw", topic: "Topic", key_idea: "Idea",
    recall_question: "Q?", next_question: null, apply_it: null, category: "Coding", language: null,
    structure_state: "structured", status: "Reviewing", next_review: day(-1), times_reviewed: 1, streak_correct: 1,
    last_result: "Correct", last_reviewed_at: day(-2), learned_at: day(-3), client_updated_at: day(-3), deleted_at: null,
    ...over,
  };
}
const map = (...es: Entry[]) => Object.fromEntries(es.map((e) => [e.id, e]));

describe("dueEntries", () => {
  it("returns entries due now, oldest first, and skips Mastered, future and deleted ones", () => {
    const list = dueEntries(map(
      entry({ id: "late", next_review: day(-1) }),
      entry({ id: "later", next_review: day(-3) }),
      entry({ id: "future", next_review: day(2) }),
      entry({ id: "mastered", status: "Mastered", next_review: null }),
      entry({ id: "gone", deleted_at: day(-1) }),
    ), NOW);
    expect(list.map((e) => e.id)).toEqual(["later", "late"]);
  });
});

describe("searchEntries", () => {
  const all = map(
    entry({ id: "a", topic: "Postgres index", category: "Coding", learned_at: day(-5) }),
    entry({ id: "b", topic: "Sourdough", category: "Cooking", status: "New", learned_at: day(-1) }),
  );
  it("matches text across fields, case-insensitively, newest first", () => {
    expect(searchEntries(all, { query: "SOUR" }).map((e) => e.id)).toEqual(["b"]);
    expect(searchEntries(all, {}).map((e) => e.id)).toEqual(["b", "a"]);
  });
  it("filters by status and category", () => {
    expect(searchEntries(all, { status: "New" }).map((e) => e.id)).toEqual(["b"]);
    expect(searchEntries(all, { category: "Coding" }).map((e) => e.id)).toEqual(["a"]);
  });
});

describe("display helpers", () => {
  it("uses the variant question first, then the original, then a fallback", () => {
    expect(currentQuestion(entry({ next_question: "Variant?" }))).toBe("Variant?");
    expect(currentQuestion(entry())).toBe("Q?");
    expect(currentQuestion(entry({ recall_question: null }))).toMatch(/Topic/);
  });
  it("titles an unstructured note by its first line", () => {
    expect(titleOf(entry({ topic: null, raw_text: "First line\nsecond" }))).toBe("First line");
  });
});

describe("reviewedEntry (offline self-grade)", () => {
  it("applies the same scheduling rules as the server", () => {
    const out = reviewedEntry(entry({ streak_correct: 0, times_reviewed: 0 }), "Correct", NOW);
    expect(out.streak_correct).toBe(1);
    expect(out.next_review).toBe(day(1));
    const mastered = reviewedEntry(entry({ streak_correct: 4 }), "Correct", NOW);
    expect(mastered.status).toBe("Mastered");
    expect(mastered.next_review).toBeNull();
  });
});

describe("mergeServerEntry", () => {
  const none = { content: false, review: false };
  it("adds new server entries and removes deleted ones", () => {
    expect(mergeServerEntry(undefined, entry(), none)?.id).toBe("e1");
    expect(mergeServerEntry(entry(), entry({ deleted_at: day(0) }), none)).toBeNull();
  });
  it("takes the server row when nothing is waiting to be sent", () => {
    expect(mergeServerEntry(entry({ topic: "old" }), entry({ topic: "new" }), none)?.topic).toBe("new");
  });
  it("keeps local text while an edit is waiting, but takes the server's review state", () => {
    const merged = mergeServerEntry(
      entry({ topic: "my edit", streak_correct: 1 }),
      entry({ topic: "server", streak_correct: 3 }),
      { content: true, review: false },
    )!;
    expect(merged.topic).toBe("my edit");
    expect(merged.streak_correct).toBe(3);
  });
  it("keeps the local schedule while a review is waiting to be sent", () => {
    const merged = mergeServerEntry(
      entry({ streak_correct: 2 }),
      entry({ streak_correct: 1 }),
      { content: false, review: true },
    )!;
    expect(merged.streak_correct).toBe(2);
  });
  it("does not delete an entry the user just edited offline", () => {
    const local = entry({ topic: "mine" });
    expect(mergeServerEntry(local, entry({ deleted_at: day(0) }), { content: true, review: false })).toBe(local);
  });
});

describe("outbox", () => {
  const create: Op = { id: "op1", kind: "entry_create", entryId: "e1", row: { id: "e1", topic: "a" } };
  it("folds an edit into an unsent create", () => {
    const out = enqueueEntryPatch([create], "e1", { topic: "b" }, "op2");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "entry_create", row: { id: "e1", topic: "b" } });
  });
  it("folds repeated edits into one update and keeps other entries separate", () => {
    let out = enqueueEntryPatch([], "e1", { topic: "a" }, "op1");
    out = enqueueEntryPatch(out, "e1", { key_idea: "k" }, "op2");
    out = enqueueEntryPatch(out, "e2", { topic: "z" }, "op3");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: "entry_update", patch: { topic: "a", key_idea: "k" } });
  });
  it("reports what is pending for an entry", () => {
    const review: Op = { id: "r", kind: "review", entryId: "e2", payload: { review_id: "x", entry_id: "e2", grade: "Correct", reviewed_at: day(0) } };
    expect(pendingFor([create, review], "e1")).toEqual({ content: true, review: false });
    expect(pendingFor([create, review], "e2")).toEqual({ content: false, review: true });
  });
});
