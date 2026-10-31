import { describe, expect, it } from "vitest";
import { WEB_MARKER, webBlock, withWebBlock } from "./research";

const sources = [{ title: "Hooks guide", url: "https://example.com/hooks" }];

describe("web research block", () => {
  it("labels the web content and lists its sources", () => {
    const b = webBlock("1. Question hook", sources);
    expect(b.startsWith(WEB_MARKER)).toBe(true);
    expect(b).toContain("1. Question hook");
    expect(b).toContain("- Hooks guide: https://example.com/hooks");
  });

  it("keeps the learner's own note first and untouched", () => {
    const out = withWebBlock("The 20 formulas for LinkedIn hooks", "1. Question hook", sources);
    expect(out.startsWith("The 20 formulas for LinkedIn hooks\n\n")).toBe(true);
    expect(out).toContain(WEB_MARKER);
  });

  it("replaces an earlier web block instead of stacking a second one", () => {
    const once = withWebBlock("My note", "old details", sources);
    const twice = withWebBlock(once, "new details", sources);
    expect(twice.split(WEB_MARKER).length).toBe(2);
    expect(twice).toContain("new details");
    expect(twice).not.toContain("old details");
  });

  it("never exceeds the 8000-character storage limit", () => {
    const out = withWebBlock("x".repeat(4000), "y".repeat(5000), sources);
    expect(out.length).toBeLessThanOrEqual(8000);
    expect(out.startsWith("x".repeat(4000))).toBe(true);
  });
});
