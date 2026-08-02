import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  currentUserDate,
  DAY_START_HOUR,
  parseLogTimestamp,
  userDayWindow,
} from "./user-day.js";

describe("DAY_START_HOUR", () => {
  it("is 4 (a 1am or 3am drink belongs to the previous user-day)", () => {
    expect(DAY_START_HOUR).toBe(4);
  });
});

describe("userDayWindow", () => {
  it("returns [date 04:00 local, next 04:00 local] in UTC for America/Toronto (EDT)", () => {
    const { startUtc, endUtc } = userDayWindow("2026-05-08", "America/Toronto");
    expect(startUtc.toISOString()).toBe("2026-05-08T08:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-05-09T08:00:00.000Z");
  });

  it("returns [date 04:00 UTC, next 04:00 UTC] for UTC profile", () => {
    const { startUtc, endUtc } = userDayWindow("2026-05-08", "UTC");
    expect(startUtc.toISOString()).toBe("2026-05-08T04:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-05-09T04:00:00.000Z");
  });

  it("a 02:00 local snack on May 9 belongs to May 8's window in America/Toronto", () => {
    const snack = new Date("2026-05-09T06:00:00.000Z"); // 02:00 EDT on May 9
    const { startUtc, endUtc } = userDayWindow("2026-05-08", "America/Toronto");
    expect(snack >= startUtc).toBe(true);
    expect(snack < endUtc).toBe(true);
  });

  it("a 05:00 local breakfast on May 9 belongs to May 9's window in America/Toronto", () => {
    const breakfast = new Date("2026-05-09T09:00:00.000Z"); // 05:00 EDT on May 9
    const { startUtc, endUtc } = userDayWindow("2026-05-09", "America/Toronto");
    expect(breakfast >= startUtc).toBe(true);
    expect(breakfast < endUtc).toBe(true);
  });
});

describe("parseLogTimestamp", () => {
  it("preserves ISO with offset as-is", () => {
    expect(parseLogTimestamp("2026-05-08T16:20:00-04:00", "America/Toronto").toISOString()).toBe(
      "2026-05-08T20:20:00.000Z",
    );
  });

  it("treats ISO with Z as UTC", () => {
    expect(parseLogTimestamp("2026-05-08T20:20:00Z", "America/Toronto").toISOString()).toBe(
      "2026-05-08T20:20:00.000Z",
    );
  });

  it("interprets naked local datetime in the user's profile timezone", () => {
    expect(parseLogTimestamp("2026-05-08T16:20:00", "America/Toronto").toISOString()).toBe(
      "2026-05-08T20:20:00.000Z",
    );
  });

  it("supports a date-only string as 00:00 local", () => {
    expect(parseLogTimestamp("2026-05-08", "America/Toronto").toISOString()).toBe(
      "2026-05-08T04:00:00.000Z",
    );
  });
});

describe("parseLogTimestamp validation", () => {
  it("rejects empty input with a clear error", () => {
    expect(() => parseLogTimestamp("", "UTC")).toThrow(/parseLogTimestamp/);
  });
  it("rejects garbage input with a clear error", () => {
    expect(() => parseLogTimestamp("garbage", "UTC")).toThrow(/parseLogTimestamp/);
  });
  it("rejects an impossible date like 2026-13-45 instead of silently rolling forward", () => {
    expect(() => parseLogTimestamp("2026-13-45", "UTC")).toThrow(/month out of range/);
  });
  it("rejects Feb 30", () => {
    expect(() => parseLogTimestamp("2026-02-30", "UTC")).toThrow(/invalid calendar date/);
  });
  it("rejects out-of-range time like 25:99:99", () => {
    expect(() => parseLogTimestamp("2026-05-08T25:99:99", "UTC")).toThrow(/hour out of range/);
  });
});

describe("userDayWindow validation", () => {
  it("rejects malformed date strings", () => {
    expect(() => userDayWindow("garbage", "UTC")).toThrow(/userDayWindow/);
  });
  it("rejects impossible dates", () => {
    expect(() => userDayWindow("2026-02-30", "UTC")).toThrow(/invalid calendar date/);
  });
});

describe("currentUserDate", () => {
  it("returns the user's calendar date based on DAY_START_HOUR rollover", () => {
    // 02:00 EDT on May 9 is still 'May 8' for user-day buckets (boundary is 04:00)
    expect(currentUserDate(new Date("2026-05-09T06:00:00Z"), "America/Toronto")).toBe("2026-05-08");
    // 05:00 EDT on May 9 has crossed into May 9
    expect(currentUserDate(new Date("2026-05-09T09:00:00Z"), "America/Toronto")).toBe("2026-05-09");
  });

  it("returns the UTC calendar date for UTC profile", () => {
    expect(currentUserDate(new Date("2026-05-09T03:00:00Z"), "UTC")).toBe("2026-05-08");
    expect(currentUserDate(new Date("2026-05-09T05:00:00Z"), "UTC")).toBe("2026-05-09");
  });
});

describe("addDaysIso", () => {
  it("adds and subtracts calendar days across month/DST boundaries", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2026-06-06", -1)).toBe("2026-06-05");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});
