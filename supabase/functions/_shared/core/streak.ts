// Daily review streak: consecutive local days with at least one review.
// Dates are 'YYYY-MM-DD' strings in the user's timezone.

export interface DailyStreak {
  current: number;
  best: number;
  /** Local date of the last review, or null if none yet. */
  lastDate: string | null;
}

/** Local calendar date ('YYYY-MM-DD') of `now` in an IANA timezone. */
export function localDate(now: Date, timeZone: string): string {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Record a review on `today`. Same day = no change; next day = +1; any gap = restart at 1. */
export function recordReviewDay(streak: DailyStreak, today: string): DailyStreak {
  // Same day, or a late-arriving offline event from before the last counted day: nothing to change.
  if (streak.lastDate !== null && today <= streak.lastDate) return streak;
  const consecutive = streak.lastDate !== null && dayNumber(today) - dayNumber(streak.lastDate) === 1;
  const current = consecutive ? streak.current + 1 : 1;
  return { current, best: Math.max(streak.best, current), lastDate: today };
}

/** Streak to display on `today`: a streak whose last day is older than yesterday has lapsed. */
export function visibleStreak(streak: DailyStreak, today: string): number {
  if (streak.lastDate === null) return 0;
  const gap = dayNumber(today) - dayNumber(streak.lastDate);
  return gap <= 1 ? streak.current : 0;
}
