export const isValidTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** "18:30" -> "6:30 PM" */
export function fmtTime(t: string): string {
  if (!isValidTime(t)) return t;
  const [h, m] = t.split(":").map(Number) as [number, number];
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Accepts "7:30", "07:30", "730" and returns "07:30", or null if it isn't a time. */
export function parseTimeInput(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const t = `${m[1]!.padStart(2, "0")}:${m[2]}`;
  return isValidTime(t) ? t : null;
}

export const deviceTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** "in 3 days", "today", "tomorrow", "2 days ago" for a due date. */
export function relativeDay(iso: string | null, now = new Date()): string {
  if (!iso) return "not scheduled";
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(new Date(iso)) - start(now)) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}
