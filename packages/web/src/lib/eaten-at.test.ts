import { describe, expect, it } from "vitest";
import { composeEatenAt } from "./eaten-at.js";

describe("composeEatenAt", () => {
  it("composes a normal daytime time onto the viewed date (naive-local, no Z)", () => {
    expect(composeEatenAt("13:30", "2026-06-22")).toBe("2026-06-22T13:30:00");
  });

  it("composes a pre-4am time onto viewedDate+1 (4am rollover window)", () => {
    // A 02:00 entry belongs to the NEXT calendar morning of the viewed day's
    // 4am→4am window, so it must land on 2026-06-23 or the API re-buckets it back.
    expect(composeEatenAt("02:00", "2026-06-22")).toBe("2026-06-23T02:00:00");
  });

  it("treats exactly 04:00 as same-day (window start is inclusive)", () => {
    expect(composeEatenAt("04:00", "2026-06-22")).toBe("2026-06-22T04:00:00");
  });

  it("guards a blank/malformed time to noon so the string is well-formed", () => {
    expect(composeEatenAt("", "2026-06-22")).toBe("2026-06-22T12:00:00");
    expect(composeEatenAt("9:5", "2026-06-22")).toBe("2026-06-22T12:00:00");
  });

  it("never produces a Z suffix", () => {
    expect(composeEatenAt("23:59", "2026-06-22")).not.toContain("Z");
  });
});
