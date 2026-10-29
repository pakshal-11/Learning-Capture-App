// Records one review and updates the entry's schedule and the user's daily streak.
// Used by grade-answer (AI), apply-review (self-graded / offline replay) and stuck-feedback ("Helped").
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { applyResult, type Grade, isStaleEvent, type SrsState } from "./core/srs.ts";
import { localDate, recordReviewDay } from "./core/streak.ts";
import { HttpError } from "./http.ts";

export interface ReviewInput {
  userId: string;
  entryId: string;
  reviewId: string;
  grade: Grade;
  source: "ai" | "self" | "stuck";
  question?: string | null;
  answer?: string | null;
  feedback?: string | null;
  correctAnswer?: string | null;
  /** When the user actually answered (offline replay). Clamped so it can't be in the future. */
  reviewedAt?: Date;
  /** Next question variant to store on the entry (from the AI grader). */
  nextQuestion?: string | null;
}

export interface ReviewResult {
  duplicate: boolean;
  /** True when an older offline event arrived after a newer one: logged, schedule untouched. */
  stale: boolean;
  entry: {
    id: string;
    status: string;
    next_review: string | null;
    times_reviewed: number;
    streak_correct: number;
    last_result: string | null;
    last_reviewed_at: string | null;
    next_question: string | null;
  };
  streak: { current: number; best: number };
}

const ENTRY_COLS = "id, status, next_review, times_reviewed, streak_correct, last_result, last_reviewed_at, next_question";

export async function recordReview(service: SupabaseClient, input: ReviewInput): Promise<ReviewResult> {
  const now = new Date();
  let reviewedAt = input.reviewedAt ?? now;
  if (reviewedAt.getTime() > now.getTime()) reviewedAt = now;

  // ownership check: the entry must belong to this user and not be deleted
  const { data: entry, error } = await service
    .from("entries").select(ENTRY_COLS)
    .eq("id", input.entryId).eq("user_id", input.userId).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!entry) throw new HttpError(404, "Entry not found.", "not_found");

  const { data: profile } = await service
    .from("profiles").select("timezone, streak_current, streak_best, last_review_date")
    .eq("id", input.userId).maybeSingle();

  const state: SrsState = {
    status: entry.status,
    streakCorrect: entry.streak_correct,
    timesReviewed: entry.times_reviewed,
    lastResult: entry.last_result,
    nextReview: entry.next_review ? new Date(entry.next_review) : null,
    lastReviewedAt: entry.last_reviewed_at ? new Date(entry.last_reviewed_at) : null,
  };
  const stale = isStaleEvent(state, reviewedAt);
  const outcome = stale ? null : applyResult(state, input.grade, reviewedAt);

  // Insert the log row first, keyed by the client's id: a replayed event inserts nothing.
  const { data: inserted, error: insErr } = await service.from("reviews").upsert({
    id: input.reviewId,
    user_id: input.userId,
    entry_id: input.entryId,
    question_shown: input.question ?? null,
    user_answer: input.answer ?? null,
    grade: input.grade,
    grade_source: input.source,
    feedback: input.feedback ?? null,
    correct_answer: input.correctAnswer ?? null,
    interval_days: outcome?.intervalDays ?? null,
    reviewed_at: reviewedAt.toISOString(),
  }, { onConflict: "id", ignoreDuplicates: true }).select("id");
  if (insErr) throw insErr;

  const streak = {
    current: profile?.streak_current ?? 0,
    best: profile?.streak_best ?? 0,
  };

  if (!inserted || inserted.length === 0) {
    return { duplicate: true, stale: false, entry, streak };
  }
  if (!outcome) return { duplicate: false, stale: true, entry, streak };

  const s = outcome.state;
  const update: Record<string, unknown> = {
    status: s.status,
    next_review: s.nextReview?.toISOString() ?? null,
    times_reviewed: s.timesReviewed,
    streak_correct: s.streakCorrect,
    last_result: s.lastResult,
    last_reviewed_at: s.lastReviewedAt?.toISOString(),
  };
  if (input.nextQuestion) update.next_question = input.nextQuestion;
  const { data: updated, error: upErr } = await service
    .from("entries").update(update).eq("id", input.entryId).select(ENTRY_COLS).single();
  if (upErr) throw upErr;

  // daily streak
  const tz = profile?.timezone ?? "UTC";
  const next = recordReviewDay(
    { current: streak.current, best: streak.best, lastDate: profile?.last_review_date ?? null },
    localDate(reviewedAt, tz),
  );
  if (next.current !== streak.current || next.best !== streak.best || next.lastDate !== profile?.last_review_date) {
    await service.from("profiles").update({
      streak_current: next.current, streak_best: next.best, last_review_date: next.lastDate,
    }).eq("id", input.userId);
  }

  return { duplicate: false, stale: false, entry: updated, streak: { current: next.current, best: next.best } };
}
