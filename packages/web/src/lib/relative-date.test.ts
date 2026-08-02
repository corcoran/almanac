import { describe, expect, it } from "vitest";
import { formatAbsoluteDateTime, formatRelativeDate } from "./relative-date.js";

describe("formatRelativeDate", () => {
  const now = new Date(2026, 4, 21, 17, 0, 0); // May 21, 2026 at 5pm local

  it("returns 'Today' for a same-day timestamp", () => {
    const past = new Date(2026, 4, 21, 9, 0, 0).toISOString();
    expect(formatRelativeDate(past, now)).toBe("Today");
  });

  it("returns 'Yesterday' for 1 calendar day ago", () => {
    const past = new Date(2026, 4, 20, 22, 0, 0).toISOString();
    expect(formatRelativeDate(past, now)).toBe("Yesterday");
  });

  it("returns 'N days ago' for 2-13 days", () => {
    expect(formatRelativeDate(new Date(2026, 4, 19).toISOString(), now)).toBe("2 days ago");
    expect(formatRelativeDate(new Date(2026, 4, 11).toISOString(), now)).toBe("10 days ago");
    expect(formatRelativeDate(new Date(2026, 4, 8).toISOString(), now)).toBe("13 days ago");
  });

  it("falls back to short absolute for 14+ days", () => {
    const past = new Date(2026, 4, 5).toISOString();
    // 16 days ago. Same year so no year in output.
    expect(formatRelativeDate(past, now)).toMatch(/May 5/);
    expect(formatRelativeDate(past, now)).not.toMatch(/2026/);
  });

  it("includes year when the past date is in a different year", () => {
    const past = new Date(2025, 11, 15).toISOString(); // Dec 15, 2025
    expect(formatRelativeDate(past, now)).toMatch(/2025/);
    expect(formatRelativeDate(past, now)).toMatch(/Dec 15/);
  });

  it("handles late-evening past dates that cross day boundaries", () => {
    // Past = yesterday at 11:30pm local. now = today at 5pm.
    // Should be "Yesterday", not "Today" (calendar-day delta is 1).
    const past = new Date(2026, 4, 20, 23, 30, 0).toISOString();
    expect(formatRelativeDate(past, now)).toBe("Yesterday");
  });
});

describe("formatAbsoluteDateTime", () => {
  it("returns a date+time string", () => {
    const iso = new Date(2026, 4, 19, 17, 42, 0).toISOString();
    const result = formatAbsoluteDateTime(iso);
    expect(result).toMatch(/May 19/);
    expect(result).toMatch(/2026/);
    // Should contain something time-ish (5 or 17 hour, and minutes).
    expect(result).toMatch(/\d:\d\d/);
  });
});
