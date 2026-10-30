import { describe, expect, it } from "vitest";
import { buildIcs } from "./ics";

const now = new Date(Date.UTC(2026, 9, 30, 6, 0, 0));

describe("ics", () => {
  it("builds an all-day event when there is no reminder time", () => {
    const ics = buildIcs([{ id: "e1", title: "Compound interest", due: new Date(2026, 10, 3) }], now);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261103");
    expect(ics).toContain("DTEND;VALUE=DATE:20261104");
    expect(ics).toContain("SUMMARY:Review: Compound interest");
    expect(ics).not.toContain("VALARM");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("builds a 10 minute timed event with an alarm", () => {
    const ics = buildIcs([{ id: "e2", title: "x", due: new Date(2026, 10, 3), time: "18:30" }], now);
    const start = new Date(2026, 10, 3, 18, 30);
    const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    expect(ics).toContain(`DTSTART:${stamp(start)}`);
    expect(ics).toContain(`DTEND:${stamp(new Date(start.getTime() + 600_000))}`);
    expect(ics).toContain("BEGIN:VALARM");
  });

  it("escapes commas, semicolons and newlines and folds long lines", () => {
    const ics = buildIcs([{ id: "e3", title: "a, b; c", due: new Date(2026, 10, 3), note: "line1\nline2 " + "z".repeat(200) }], now);
    expect(ics).toContain("SUMMARY:Review: a\\, b\\; c");
    expect(ics).toContain("line1\\nline2");
    for (const l of ics.split("\r\n")) expect(l.length).toBeLessThanOrEqual(71);
  });
});
