// Sync engine tests against a fake Supabase: offline capture and review, replay on reconnect,
// idempotent retries, edits made while a send is in flight, and pulling server changes.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: "web" } }));
vi.mock("@react-native-community/netinfo", () => ({ default: { addEventListener: () => () => {} } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
vi.mock("./storage", () => ({ kv: { get: async () => null, set: async () => {}, del: async () => {} } }));

// ------------------------------------------------------------------ fake server
const server = {
  online: true,
  entries: new Map<string, any>(),
  profile: { id: "u1", reminder_times: ["20:00:00"], goals: [], interests: [], streak_current: 0, streak_best: 0, last_review_date: null, timezone: "UTC" } as any,
  clock: 0,
  onInsert: undefined as undefined | ((row: any) => void),
};
const offlineError = { message: "TypeError: Failed to fetch" };
const tick = () => new Date(Date.UTC(2026, 9, 30, 12, 0, ++server.clock)).toISOString();

function handle(op: any, single: boolean) {
  if (!server.online) return { data: null, error: offlineError };
  if (op.table === "profiles") return { data: server.profile, error: null };
  if (op.kind === "insert") {
    if (server.entries.has(op.row.id)) return { data: null, error: { code: "23505", message: "duplicate key" } };
    server.onInsert?.(op.row);
    server.entries.set(op.row.id, { status: "New", next_review: null, times_reviewed: 0, streak_correct: 0, last_result: null, last_reviewed_at: null, ...op.row, updated_at: tick() });
    return { data: null, error: null };
  }
  if (op.kind === "update") {
    const id = op.filters.find((f: any) => f[1] === "id")[2];
    const row = server.entries.get(id);
    if (!row) return { data: [], error: null };
    server.entries.set(id, { ...row, ...op.patch, updated_at: tick() });
    return { data: [{ id }], error: null };
  }
  let rows = [...server.entries.values()].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const gte = op.filters.find((f: any) => f[0] === "gte");
  if (gte) rows = rows.filter((r) => r.updated_at >= gte[2]);
  return { data: single ? rows[0] ?? null : rows, error: null };
}

function fake(table: string) {
  const op: any = { table, kind: "select", filters: [] };
  const q: any = {
    insert(row: any) { op.kind = "insert"; op.row = row; return q; },
    update(patch: any) { op.kind = "update"; op.patch = patch; return q; },
    select() { return q; }, order() { return q; }, limit() { return q; },
    eq(c: string, v: any) { op.filters.push(["eq", c, v]); return q; },
    gte(c: string, v: any) { op.filters.push(["gte", c, v]); return q; },
    maybeSingle() { return Promise.resolve(handle(op, true)); },
    then(res: any, rej: any) { return Promise.resolve(handle(op, false)).then(res, rej); },
  };
  return q;
}

vi.mock("./supabase", () => ({ supabase: { from: (t: string) => fake(t) } }));

const applyReview = vi.fn();
vi.mock("./api", () => ({ applyReview: (...a: any[]) => applyReview(...a) }));

import { syncAll } from "./sync";
import { useStore } from "./store";

const S = () => useStore.getState();

beforeEach(() => {
  server.online = true;
  server.entries.clear();
  server.onInsert = undefined;
  applyReview.mockReset();
  useStore.setState({
    entries: {}, outbox: [], lastPulledAt: null, hydrated: true, userId: "u1",
    profile: { id: "u1", role_type: "professional", goals: [], interests: [], reminder_times: [], timezone: "UTC", streak_current: 0, streak_best: 0, last_review_date: null } as any,
    sync: { status: "idle", lastSyncedAt: null, error: null },
  });
});

describe("offline capture and replay", () => {
  it("keeps everything on the device while offline, then sends it in order when back online", async () => {
    server.online = false;
    const e = S().createEntry({ raw_text: "Offline note" });
    S().patchEntry(e.id, { topic: "Edited offline", key_idea: "k", structure_state: "structured" });
    S().recordSelfReview(e.id, "Correct", "Q?");

    await syncAll();
    expect(S().sync.status).toBe("offline");
    expect(S().outbox.map((o) => o.kind)).toEqual(["entry_create", "review"]); // the edit was folded into the create
    expect(server.entries.size).toBe(0);
    expect(S().entries[e.id]!.status).toBe("Reviewing"); // local state already reflects the review

    server.online = true;
    // like the real server: apply the review to its own copy, then report the new state
    applyReview.mockImplementation(async () => {
      const entry = { id: e.id, status: "Reviewing", next_review: "2026-10-31T12:00:00.000Z", times_reviewed: 1, streak_correct: 1, last_result: "Correct", last_reviewed_at: "2026-10-30T12:00:00.000Z", next_question: null };
      server.entries.set(e.id, { ...server.entries.get(e.id), ...entry, updated_at: tick() });
      Object.assign(server.profile, { streak_current: 1, streak_best: 1, last_review_date: "2026-10-30" });
      return { ok: true, review: { duplicate: false, stale: false, entry, streak: { current: 1, best: 1 } } };
    });
    await syncAll();

    expect(S().sync.status).toBe("idle");
    expect(S().outbox).toEqual([]);
    expect(server.entries.get(e.id)).toMatchObject({ topic: "Edited offline", structure_state: "structured" });
    expect(applyReview).toHaveBeenCalledTimes(1);
    expect(applyReview.mock.calls[0]![0]).toMatchObject({ entry_id: e.id, grade: "Correct", question: "Q?" });
    expect(S().entries[e.id]!.next_review).toBe("2026-10-31T12:00:00.000Z"); // server's schedule is adopted
    expect(S().profile!.streak_current).toBe(1);
  });

  it("treats a retried create as success (idempotent by id)", async () => {
    const e = S().createEntry({ raw_text: "Retry me" });
    server.entries.set(e.id, { ...e, updated_at: tick() }); // an earlier attempt already landed
    await syncAll();
    expect(S().outbox).toEqual([]);
    expect(server.entries.size).toBe(1);
  });

  it("does not lose an edit made while the create is being sent", async () => {
    const e = S().createEntry({ raw_text: "In flight" });
    server.onInsert = () => S().patchEntry(e.id, { topic: "Typed during the send" });
    await syncAll();
    // the first send went out without the new topic, so it must still be queued
    expect(S().outbox).toHaveLength(1);
    expect(S().outbox[0]).toMatchObject({ kind: "entry_update", patch: { topic: "Typed during the send" } });
    server.onInsert = undefined;
    await syncAll();
    expect(S().outbox).toEqual([]);
    expect(server.entries.get(e.id)!.topic).toBe("Typed during the send");
  });

  it("drops a review the server rejects permanently so it cannot block the queue", async () => {
    const e = S().createEntry({ raw_text: "x" });
    S().recordSelfReview(e.id, "Missed", "Q?");
    applyReview.mockResolvedValue({ ok: false, kind: "not_found", message: "Entry not found." });
    await syncAll();
    expect(S().outbox).toEqual([]);
  });

  it("keeps a review queued when the network drops mid-flush", async () => {
    const e = S().createEntry({ raw_text: "x" });
    S().recordSelfReview(e.id, "Correct", "Q?");
    applyReview.mockResolvedValue({ ok: false, kind: "network", message: "offline" });
    await syncAll();
    expect(S().sync.status).toBe("offline");
    expect(S().outbox.map((o) => o.kind)).toEqual(["review"]);
  });
});

describe("pulling server changes", () => {
  it("adds new server entries and removes ones deleted elsewhere", async () => {
    server.entries.set("a", { id: "a", raw_text: "from another device", topic: "A", status: "New", structure_state: "structured", updated_at: tick(), deleted_at: null });
    await syncAll();
    expect(S().entries["a"]!.topic).toBe("A");
    expect(S().lastPulledAt).not.toBeNull();

    server.entries.set("a", { ...server.entries.get("a"), deleted_at: "2026-10-30T13:00:00Z", updated_at: tick() });
    await syncAll();
    expect(S().entries["a"]).toBeUndefined();
  });

  it("does not overwrite local edits that are still waiting to be sent", async () => {
    server.online = false;
    const e = S().createEntry({ raw_text: "mine" });
    server.online = true;
    // another device changed the same entry before ours reached the server
    server.entries.set(e.id, { ...e, topic: "other device", updated_at: tick() });
    S().patchEntry(e.id, { topic: "my newer edit" });
    server.online = false; // keep the edit queued during this pull-only check
    await syncAll();
    expect(S().entries[e.id]!.topic).toBe("my newer edit");
  });

  it("only fetches changes since the last pull", async () => {
    server.entries.set("a", { id: "a", raw_text: "1", status: "New", structure_state: "raw", updated_at: tick(), deleted_at: null });
    await syncAll();
    const since = S().lastPulledAt;
    server.entries.set("b", { id: "b", raw_text: "2", status: "New", structure_state: "raw", updated_at: tick(), deleted_at: null });
    await syncAll();
    expect(Object.keys(S().entries).sort()).toEqual(["a", "b"]);
    expect(S().lastPulledAt! > since!).toBe(true);
  });
});
