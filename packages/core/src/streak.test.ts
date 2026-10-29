import { describe, expect, it } from "vitest";
import { localDate, recordReviewDay, visibleStreak, type DailyStreak } from "./streak.ts";

const empty: DailyStreak = { current: 0, best: 0, lastDate: null };

describe("localDate", () => {
  it("uses the user's timezone for the calendar day", () => {
    const now = new Date("2026-10-30T20:00:00Z"); // 01:30 on the 31st in India
    expect(localDate(now, "Asia/Kolkata")).toBe("2026-10-31");
    expect(localDate(now, "UTC")).toBe("2026-10-30");
    expect(localDate(now, "America/Los_Angeles")).toBe("2026-10-30");
  });

  it("falls back to UTC for an invalid timezone", () => {
    expect(localDate(new Date("2026-10-30T20:00:00Z"), "Not/AZone")).toBe("2026-10-30");
  });
});

describe("recordReviewDay", () => {
  it("starts at 1 on the first review", () => {
    expect(recordReviewDay(empty, "2026-10-30")).toEqual({ current: 1, best: 1, lastDate: "2026-10-30" });
  });

  it("does not change on a second review the same day", () => {
    const s = recordReviewDay(empty, "2026-10-30");
    expect(recordReviewDay(s, "2026-10-30")).toEqual(s);
  });

  it("increments on consecutive days, including across a month boundary", () => {
    let s = recordReviewDay(empty, "2026-10-30");
    s = recordReviewDay(s, "2026-10-31");
    s = recordReviewDay(s, "2026-11-01");
    expect(s).toEqual({ current: 3, best: 3, lastDate: "2026-11-01" });
  });

  it("ignores a late offline event from before the last counted day", () => {
    const s: DailyStreak = { current: 3, best: 3, lastDate: "2026-10-30" };
    expect(recordReviewDay(s, "2026-10-28")).toEqual(s);
  });

  it("restarts at 1 after a gap but keeps the best", () => {
    let s = recordReviewDay(empty, "2026-10-28");
    s = recordReviewDay(s, "2026-10-29");
    s = recordReviewDay(s, "2026-11-02");
    expect(s).toEqual({ current: 1, best: 2, lastDate: "2026-11-02" });
  });
});

describe("visibleStreak", () => {
  const s: DailyStreak = { current: 4, best: 6, lastDate: "2026-10-29" };
  it("shows the streak if the last review was today or yesterday", () => {
    expect(visibleStreak(s, "2026-10-29")).toBe(4);
    expect(visibleStreak(s, "2026-10-30")).toBe(4);
  });
  it("shows 0 once a day has been missed", () => {
    expect(visibleStreak(s, "2026-10-31")).toBe(0);
  });
  it("shows 0 with no history", () => {
    expect(visibleStreak(empty, "2026-10-31")).toBe(0);
  });
});
