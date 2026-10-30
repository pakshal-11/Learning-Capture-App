// Typed calls to the Edge Functions. Every AI call goes here; the client never talks to Anthropic.
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "./supabase";
import type { Grade } from "./types";

export interface ApiError {
  ok: false;
  kind: "network" | "auth" | "bad_request" | "not_found" | "server";
  message: string;
}

export interface Quota {
  used: number;
  limit: number;
}

/** A spending cap was reached or the AI had a problem: show `message`, offer a manual fallback. */
export interface AiUnavailable {
  ok: false;
  unavailable: boolean;
  reason: string;
  message: string;
  quota?: Quota;
}

export type ApiResult<T> = (T & { ok: true }) | ApiError;
export type AiResult<T> = (T & { ok: true; quota?: Quota }) | AiUnavailable | ApiError;

export const isApiError = (r: { ok: boolean }): r is ApiError => !r.ok && "kind" in r;
export const isUnavailable = (r: { ok: boolean }): r is AiUnavailable => !r.ok && "unavailable" in r;

async function invoke<T>(name: string, body: unknown): Promise<T | ApiError> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, kind: "auth", message: "Please sign in again." };

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, kind: "network", message: "You're offline. Try again when you're connected." };
  }

  const json = await res.json().catch(() => null);
  if (res.ok) return (json ?? { ok: true }) as T;
  const message = json?.message ?? "Something went wrong. Please try again.";
  if (res.status === 401) return { ok: false, kind: "auth", message };
  if (res.status === 404) return { ok: false, kind: "not_found", message };
  if (res.status >= 400 && res.status < 500) return { ok: false, kind: "bad_request", message };
  return { ok: false, kind: "server", message };
}

// ----------------------------------------------------------------------------------------------

export interface StructuredNote {
  topic: string;
  key_idea: string;
  recall_question: string;
  apply_it: string;
  category: string;
}

export const structureNote = (raw_text: string) =>
  invoke<AiResult<{ note: StructuredNote }>>("structure-note", { raw_text });

export interface ReviewState {
  duplicate: boolean;
  stale: boolean;
  entry: {
    id: string;
    status: "New" | "Reviewing" | "Mastered";
    next_review: string | null;
    times_reviewed: number;
    streak_correct: number;
    last_result: Grade | null;
    last_reviewed_at: string | null;
    next_question: string | null;
  };
  streak: { current: number; best: number };
}

export const gradeAnswer = (input: { entry_id: string; review_id: string; question: string; answer: string }) =>
  invoke<AiResult<{ grade: Grade; feedback: string; correct_answer: string; next_question: string; review: ReviewState }>>(
    "grade-answer",
    input,
  );

export const applyReview = (input: {
  review_id: string;
  entry_id: string;
  grade: Grade;
  question?: string;
  answer?: string;
  reviewed_at?: string;
}) => invoke<ApiResult<{ review: ReviewState }>>("apply-review", input);

export interface StuckMatch {
  entry_id: string;
  topic: string | null;
  key_idea: string | null;
  apply_it: string | null;
  why: string;
  how_to_use: string;
}

export const findStuck = (problem: string) =>
  invoke<AiResult<{ query_id: string; none_relevant: boolean; matches: StuckMatch[]; message: string }>>("find-stuck", {
    problem,
  });

export const stuckFeedback = (input: { query_id: string; entry_id: string; rating: "helped" | "partly" | "didnt" }) =>
  invoke<ApiResult<{ reinforced: boolean; review: ReviewState | null }>>("stuck-feedback", input);

export const nextQuestion = (entry_id: string) => invoke<AiResult<{ question: string }>>("next-question", { entry_id });

export const deleteAccount = () => invoke<ApiResult<object>>("delete-account", { confirm: "DELETE" });

/** Returns the export as text (JSON), or an error. */
export async function exportData(): Promise<{ ok: true; text: string } | ApiError> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, kind: "auth", message: "Please sign in again." };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/export-data`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok) return { ok: false, kind: "server", message: "Could not export your data. Try again." };
    return { ok: true, text: await res.text() };
  } catch {
    return { ok: false, kind: "network", message: "You're offline. Try again when you're connected." };
  }
}
