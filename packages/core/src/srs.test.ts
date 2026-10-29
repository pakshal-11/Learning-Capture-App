import { describe, expect, it } from "vitest";
import {
  addDays,
  applyResult,
  initialState,
  intervalForStreak,
  isDue,
  isStaleEvent,
  type Grade,
  type SrsState,
} from "./srs.ts";

const T0 = new Date("2026-10-30T09:00:00Z");

/** Apply grades one day apart, returning the final state. */
function run(grades: Grade[], start: SrsState = initialState(T0)): SrsState {
  let state = start;
  grades.forEach((g, i) => {
    state = applyResult(state, g, addDays(T0, i + 1)).state;
  });
  return state;
}

describe("initialState", () => {
  it("is New with first review due the next day", () => {
    const s = initialState(T0);
    expect(s.status).toBe("New");
    expect(s.streakCorrect).toBe(0);
    expect(s.timesReviewed).toBe(0);
    expect(s.lastResult).toBeNull();
    expect(s.nextReview).toEqual(addDays(T0, 1));
  });
});

describe("Correct", () => {
  it("follows the 1, 3, 7, 14 day progression", () => {
    const expected = [1, 3, 7, 14];
    let state = initialState(T0);
    expected.forEach((days, i) => {
      const now = addDays(T0, 10 * (i + 1));
      const out = applyResult(state, "Correct", now);
      expect(out.intervalDays).toBe(days);
      expect(out.state.nextReview).toEqual(addDays(now, days));
      expect(out.state.status).toBe("Reviewing");
      expect(out.state.streakCorrect).toBe(i + 1);
      state = out.state;
    });
  });

  it("becomes Mastered on the 5th consecutive Correct and leaves the due queue", () => {
    const state = run(["Correct", "Correct", "Correct", "Correct", "Correct"]);
    expect(state.status).toBe("Mastered");
    expect(state.streakCorrect).toBe(5);
    expect(state.nextReview).toBeNull();
    expect(state.timesReviewed).toBe(5);
  });

  it("records the 30 day interval on the 5th Correct", () => {
    const four = run(["Correct", "Correct", "Correct", "Correct"]);
    expect(applyResult(four, "Correct", addDays(T0, 10)).intervalDays).toBe(30);
  });

  it("stays Mastered on further Correct answers (e.g. 'Helped' in I'm stuck)", () => {
    const mastered = run(["Correct", "Correct", "Correct", "Correct", "Correct"]);
    const out = applyResult(mastered, "Correct", addDays(T0, 20));
    expect(out.state.status).toBe("Mastered");
    expect(out.state.nextReview).toBeNull();
    expect(out.state.streakCorrect).toBe(6);
  });
});

describe("Partly", () => {
  it("is due in 2 days and leaves the streak unchanged", () => {
    const afterThree = run(["Correct", "Correct", "Correct"]);
    const now = addDays(T0, 10);
    const out = applyResult(afterThree, "Partly", now);
    expect(out.state.streakCorrect).toBe(3);
    expect(out.state.nextReview).toEqual(addDays(now, 2));
    expect(out.state.lastResult).toBe("Partly");
    expect(out.state.status).toBe("Reviewing");
  });

  it("counts as a review but does not break the path to Mastered", () => {
    // 3 Correct, Partly, 2 more Correct = 5 Correct in total -> Mastered
    const state = run(["Correct", "Correct", "Correct", "Partly", "Correct", "Correct"]);
    expect(state.status).toBe("Mastered");
    expect(state.timesReviewed).toBe(6);
  });

  it("moves a New entry to Reviewing", () => {
    expect(applyResult(initialState(T0), "Partly", T0).state.status).toBe("Reviewing");
  });
});

describe("Missed", () => {
  it("is due the next day and resets the progression", () => {
    const afterThree = run(["Correct", "Correct", "Correct"]);
    const now = addDays(T0, 10);
    const out = applyResult(afterThree, "Missed", now);
    expect(out.state.streakCorrect).toBe(0);
    expect(out.state.nextReview).toEqual(addDays(now, 1));
    expect(out.state.lastResult).toBe("Missed");
  });

  it("restarts the interval ladder at 1 day", () => {
    const state = run(["Correct", "Correct", "Missed"]);
    const out = applyResult(state, "Correct", addDays(T0, 10));
    expect(out.intervalDays).toBe(1);
    expect(out.state.streakCorrect).toBe(1);
  });

  it("puts a Mastered entry back into review", () => {
    const mastered = run(["Correct", "Correct", "Correct", "Correct", "Correct"]);
    const out = applyResult(mastered, "Missed", addDays(T0, 20));
    expect(out.state.status).toBe("Reviewing");
    expect(out.state.nextReview).not.toBeNull();
    expect(out.state.streakCorrect).toBe(0);
  });
});

describe("helpers", () => {
  it("does not mutate the input state", () => {
    const state = initialState(T0);
    const snapshot = structuredClone(state);
    applyResult(state, "Correct", addDays(T0, 1));
    expect(state).toEqual(snapshot);
  });

  it("intervalForStreak clamps to the ladder", () => {
    expect(intervalForStreak(0)).toBe(1);
    expect(intervalForStreak(1)).toBe(1);
    expect(intervalForStreak(5)).toBe(30);
    expect(intervalForStreak(9)).toBe(30);
  });

  it("isDue is true at or after nextReview and false when unscheduled", () => {
    const state = initialState(T0);
    expect(isDue(state, T0)).toBe(false);
    expect(isDue(state, addDays(T0, 1))).toBe(true);
    expect(isDue({ ...state, nextReview: null }, addDays(T0, 100))).toBe(false);
  });

  it("isStaleEvent flags events not newer than the last review", () => {
    const reviewed = applyResult(initialState(T0), "Correct", addDays(T0, 2)).state;
    expect(isStaleEvent(initialState(T0), T0)).toBe(false);
    expect(isStaleEvent(reviewed, addDays(T0, 1))).toBe(true);
    expect(isStaleEvent(reviewed, addDays(T0, 2))).toBe(true);
    expect(isStaleEvent(reviewed, addDays(T0, 3))).toBe(false);
  });
});
