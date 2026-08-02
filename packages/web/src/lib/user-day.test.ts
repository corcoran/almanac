import { describe, expect, it } from "vitest";
import { currentUserDate, daysAgoUserDate, daysAhead, nowNaiveLocal } from "./user-day.js";

describe("user-day helpers", () => {
  it("currentUserDate returns YYYY-MM-DD in the given timezone", () => {
    // 2026-05-21 15:00 UTC = 2026-05-21 11:00 New_York (well past the 4am
    // rollover, so the calendar date is unaffected by it).
    const utcDate = new Date("2026-05-21T15:00:00Z");
    expect(currentUserDate(utcDate, "America/New_York")).toBe("2026-05-21");
    expect(currentUserDate(utcDate, "UTC")).toBe("2026-05-21");
  });

  it("currentUserDate applies the 4am day-start rollover (matches backend)", () => {
    // 1:32am New_York is before the 4am rollover, so it still belongs to the
    // PREVIOUS calendar day — exactly as the backend's currentUserDate does.
    // 2026-06-04T05:32:00Z = 2026-06-04 01:32 New_York → user-day 2026-06-03.
    const preRollover = new Date("2026-06-04T05:32:00Z");
    expect(currentUserDate(preRollover, "America/New_York")).toBe("2026-06-03");

    // 4:30am New_York is past the rollover → the new calendar day.
    // 2026-06-04T08:30:00Z = 2026-06-04 04:30 New_York → user-day 2026-06-04.
    const postRollover = new Date("2026-06-04T08:30:00Z");
    expect(currentUserDate(postRollover, "America/New_York")).toBe("2026-06-04");
  });

  it("daysAgoUserDate(0) === currentUserDate", () => {
    const now = new Date("2026-05-21T15:00:00Z");
    expect(daysAgoUserDate(now, 0, "America/New_York")).toBe(
      currentUserDate(now, "America/New_York"),
    );
  });

  it("daysAgoUserDate(6) returns the date 6 calendar days back", () => {
    const now = new Date("2026-05-21T15:00:00Z"); // 11am NY local
    expect(daysAgoUserDate(now, 6, "America/New_York")).toBe("2026-05-15");
  });

  it("daysAgoUserDate(13) returns 14-day window start (used by weight sparkline)", () => {
    const now = new Date("2026-05-21T15:00:00Z");
    expect(daysAgoUserDate(now, 13, "America/New_York")).toBe("2026-05-08");
  });

  it("daysAhead(1) returns tomorrow's user-date (exclusive `to` bound for sleep/weight)", () => {
    const now = new Date("2026-05-21T15:00:00Z"); // 11am NY local
    expect(daysAhead(now, 1, "America/New_York")).toBe("2026-05-22");
  });

  it("daysAhead(7) returns next-week's user-date", () => {
    const now = new Date("2026-05-21T15:00:00Z");
    expect(daysAhead(now, 7, "America/New_York")).toBe("2026-05-28");
  });

  it("nowNaiveLocal returns YYYY-MM-DDTHH:MM:SS wall-clock in the timezone (no Z)", () => {
    // 2026-05-21 15:30:45 UTC = 11:30:45 in New_York (EDT, UTC-4).
    const at = new Date("2026-05-21T15:30:45Z");
    expect(nowNaiveLocal(at, "America/New_York")).toBe("2026-05-21T11:30:45");
    expect(nowNaiveLocal(at, "UTC")).toBe("2026-05-21T15:30:45");
  });

  it("nowNaiveLocal carries an evening event back to the same local day (the workout-tomorrow bug)", () => {
    // 2026-06-22 01:45:00 UTC = 2026-06-21 21:45:00 New_York. A naive UTC
    // toISOString() would have sent "2026-06-22T..." (tomorrow); the naive-local
    // string keeps it on the user's actual day so the API buckets it correctly.
    const eveningUtc = new Date("2026-06-22T01:45:00Z");
    expect(nowNaiveLocal(eveningUtc, "America/New_York")).toBe("2026-06-21T21:45:00");
  });

  it("nowNaiveLocal does NOT apply the 4am rollover (the API does that on bucketing)", () => {
    // 2am local is a real wall-clock time and must be emitted verbatim; the
    // backend's parseLogTimestamp applies DAY_START_HOUR when it buckets.
    const preDawn = new Date("2026-06-04T06:00:00Z"); // 02:00 New_York
    expect(nowNaiveLocal(preDawn, "America/New_York")).toBe("2026-06-04T02:00:00");
  });
});
