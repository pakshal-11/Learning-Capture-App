// Sync engine: sends the outbox in order, then pulls changes. Safe to call at any time and offline.
import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
import { applyReview } from "./api";
import { pendingFor, mergeServerEntry } from "./entries";
import { supabase } from "./supabase";
import { hooks, useStore } from "./store";
import { ENTRY_COLUMNS, type Entry, type Op, type Profile } from "./types";

const PAGE = 500;

let running = false;
let rerun = false;
let soonTimer: ReturnType<typeof setTimeout> | undefined;

type SendResult = "done" | "drop" | "offline";

const isNetworkError = (e: { code?: string; message?: string } | null) =>
  !!e && !e.code && /fetch|network|timeout|offline|load failed/i.test(e.message ?? "");

export function normalizeProfile(row: Record<string, unknown>): Profile {
  const times = ((row.reminder_times as string[] | null) ?? []).map((t) => t.slice(0, 5));
  return { ...(row as unknown as Profile), reminder_times: times, goals: (row.goals as string[]) ?? [], interests: (row.interests as string[]) ?? [] };
}

/** After a successful send, drop the op, unless it was edited while in flight (then keep the newer data). */
function finishOp(sent: Op) {
  useStore.setState((s) => {
    const current = s.outbox.find((o) => o.id === sent.id);
    if (!current) return {};
    if (current.kind === "entry_create" && sent.kind === "entry_create" && current.row !== sent.row) {
      const { id: _id, ...rest } = current.row;
      return {
        outbox: s.outbox.map((o) => (o.id === sent.id ? { id: o.id, kind: "entry_update", entryId: current.entryId, patch: rest } as Op : o)),
      };
    }
    if (current.kind === "entry_update" && sent.kind === "entry_update" && current.patch !== sent.patch) return {};
    return { outbox: s.outbox.filter((o) => o.id !== sent.id) };
  });
}

async function sendOp(op: Op): Promise<SendResult> {
  if (op.kind === "entry_create") {
    const { error } = await supabase.from("entries").insert(op.row);
    if (!error || error.code === "23505") return "done"; // already there from an earlier attempt
    return isNetworkError(error) ? "offline" : "drop";
  }
  if (op.kind === "entry_update") {
    const { data, error } = await supabase.from("entries").update(op.patch).eq("id", op.entryId).select("id");
    if (error) return isNetworkError(error) ? "offline" : "drop";
    return data && data.length > 0 ? "done" : "drop";
  }
  const r = await applyReview(op.payload);
  if (r.ok) {
    finishOp(op);
    useStore.getState().applyServerReview(r.review);
    return "done";
  }
  if (r.kind === "network" || r.kind === "auth" || r.kind === "server") return "offline";
  return "drop";
}

async function flushOutbox(): Promise<"ok" | "offline"> {
  for (const op of [...useStore.getState().outbox]) {
    const result = await sendOp(op);
    if (result === "offline") return "offline";
    if (op.kind !== "review") finishOp(op);
    else if (result === "drop") useStore.setState((s) => ({ outbox: s.outbox.filter((o) => o.id !== op.id) }));
  }
  return "ok";
}

async function pullProfile() {
  const userId = useStore.getState().userId;
  if (!userId) return;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return;
  const server = normalizeProfile(data);
  const s = useStore.getState();
  const keepStreak = s.outbox.some((o) => o.kind === "review") && s.profile;
  useStore.setState({
    profile: keepStreak
      ? { ...server, streak_current: s.profile!.streak_current, streak_best: s.profile!.streak_best, last_review_date: s.profile!.last_review_date }
      : server,
  });
}

async function pullEntries() {
  let since = useStore.getState().lastPulledAt;
  for (let guard = 0; guard < 200; guard++) {
    let q = supabase.from("entries").select(ENTRY_COLUMNS).order("updated_at", { ascending: true }).limit(PAGE);
    if (since) q = q.gte("updated_at", since);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as unknown as Array<Entry & { updated_at: string }>;

    useStore.setState((s) => {
      const entries = { ...s.entries };
      for (const { updated_at: _u, ...server } of rows) {
        const merged = mergeServerEntry(entries[server.id], server as Entry, pendingFor(s.outbox, server.id));
        if (merged) entries[server.id] = merged;
        else delete entries[server.id];
      }
      return { entries };
    });

    const last = rows.at(-1)?.updated_at;
    if (!last || rows.length < PAGE || last === since) {
      if (last) useStore.setState({ lastPulledAt: last });
      return;
    }
    since = last;
    useStore.setState({ lastPulledAt: last });
  }
}

export async function syncAll(): Promise<void> {
  const s = useStore.getState();
  if (!s.userId || !s.hydrated) return;
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  useStore.getState().setSync({ status: "syncing" });
  try {
    if ((await flushOutbox()) === "offline") {
      useStore.getState().setSync({ status: "offline" });
      return;
    }
    await pullProfile();
    await pullEntries();
    useStore.getState().setSync({ status: "idle", lastSyncedAt: new Date().toISOString(), error: null });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const offline = isNetworkError({ message });
    useStore.getState().setSync({ status: offline ? "offline" : "error", error: offline ? null : message });
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      void syncAll();
    }
  }
}

hooks.syncSoon = () => {
  if (soonTimer) clearTimeout(soonTimer);
  soonTimer = setTimeout(() => void syncAll(), 800);
};

/** Starts background triggers: app foregrounded, network back, and a 30 s timer. Returns a stop function. */
export function startSyncLoop(): () => void {
  void syncAll();
  const interval = setInterval(() => void syncAll(), 30_000);
  const app = AppState.addEventListener("change", (st) => st === "active" && void syncAll());
  const net = NetInfo.addEventListener((st) => st.isConnected && void syncAll());
  return () => {
    clearInterval(interval);
    app.remove();
    net();
  };
}
