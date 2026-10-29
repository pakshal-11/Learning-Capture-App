// Spaced-repetition scheduling. Pure and dependency-free: runs on the client (offline
// self-grading) and in Edge Functions (copied by scripts/sync-core.mjs).
//
// Rules (confirmed in PLAN.md section 12a):
//   Correct -> streak + 1; interval by streak: 1d, 3d, 7d, 14d, 30d; 5 in a row = Mastered
//   Partly  -> streak unchanged; due in 2 days
//   Missed  -> streak reset to 0; due next day
//   Mastered entries leave the due queue (nextReview = null).

export type Grade = "Correct" | "Partly" | "Missed";
export type Status = "New" | "Reviewing" | "Mastered";

export interface SrsState {
  status: Status;
  /** Consecutive-Correct counter (Partly leaves it unchanged, Missed resets it). */
  streakCorrect: number;
  timesReviewed: number;
  lastResult: Grade | null;
  /** null = not scheduled (Mastered). */
  nextReview: Date | null;
  lastReviewedAt: Date | null;
}

export const INTERVALS_DAYS = [1, 3, 7, 14, 30] as const;
export const MASTERED_AT = 5;
export const PARTLY_DAYS = 2;
export const MISSED_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** State of a freshly captured entry: New, first review due the next day. */
export function initialState(learnedAt: Date): SrsState {
  return {
    status: "New",
    streakCorrect: 0,
    timesReviewed: 0,
    lastResult: null,
    nextReview: addDays(learnedAt, 1),
    lastReviewedAt: null,
  };
}

/** Interval (days) earned by reaching `streak` consecutive Correct answers. */
export function intervalForStreak(streak: number): number {
  const index = Math.min(Math.max(streak, 1), INTERVALS_DAYS.length) - 1;
  return INTERVALS_DAYS[index]!;
}

export interface ReviewOutcome {
  state: SrsState;
  /** Interval earned by this review in days (null when Mastered or Missed/Partly use fixed days). */
  intervalDays: number | null;
}

/** Apply one review result. Never mutates `state`. */
export function applyResult(state: SrsState, grade: Grade, now: Date): ReviewOutcome {
  const base = {
    timesReviewed: state.timesReviewed + 1,
    lastResult: grade,
    lastReviewedAt: now,
  };

  if (grade === "Correct") {
    const streakCorrect = state.streakCorrect + 1;
    const intervalDays = intervalForStreak(streakCorrect);
    if (streakCorrect >= MASTERED_AT) {
      return { state: { ...base, status: "Mastered", streakCorrect, nextReview: null }, intervalDays };
    }
    return {
      state: { ...base, status: "Reviewing", streakCorrect, nextReview: addDays(now, intervalDays) },
      intervalDays,
    };
  }

  if (grade === "Partly") {
    return {
      state: {
        ...base,
        status: "Reviewing",
        streakCorrect: state.streakCorrect,
        nextReview: addDays(now, PARTLY_DAYS),
      },
      intervalDays: PARTLY_DAYS,
    };
  }

  return {
    state: { ...base, status: "Reviewing", streakCorrect: 0, nextReview: addDays(now, MISSED_DAYS) },
    intervalDays: MISSED_DAYS,
  };
}

/**
 * Offline replay can deliver events late. An event older than the entry's last review
 * is stored in the log but must not change the schedule.
 */
export function isStaleEvent(state: SrsState, reviewedAt: Date): boolean {
  return state.lastReviewedAt !== null && reviewedAt.getTime() <= state.lastReviewedAt.getTime();
}

export function isDue(state: SrsState, now: Date): boolean {
  return state.nextReview !== null && state.nextReview.getTime() <= now.getTime();
}
