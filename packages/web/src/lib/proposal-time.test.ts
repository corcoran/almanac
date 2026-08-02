import { describe, expect, it } from "vitest";
import { proposalTime } from "./proposal-time.js";

// A fixed "real today" so the now/noon branch is deterministic without faking time.
const REAL_TODAY = "2026-08-02";

describe("proposalTime", () => {
  describe("timeSource", () => {
    it("is 'message' when the item captured its own timestamp", () => {
      const t = proposalTime({
        capturedAt: "2026-08-02T13:00:00",
        viewedDate: "2026-08-02",
        realToday: REAL_TODAY,
      });
      expect(t.timeSource).toBe("message");
    });

    it("is 'earlier' when no own time but a conversation fallback exists", () => {
      const t = proposalTime({
        capturedAt: undefined,
        fallbackTime: "12:30",
        viewedDate: "2026-08-02",
        realToday: REAL_TODAY,
      });
      expect(t.timeSource).toBe("earlier");
    });

    it("is 'now' when neither own time nor fallback exists", () => {
      const t = proposalTime({
        capturedAt: undefined,
        viewedDate: "2026-08-02",
        realToday: REAL_TODAY,
      });
      expect(t.timeSource).toBe("now");
    });
  });

  describe("seedTime", () => {
    it("prefers the item's own HH:MM from capturedAt", () => {
      const t = proposalTime({
        capturedAt: "2026-08-01T21:30:00",
        fallbackTime: "12:30",
        viewedDate: "2026-08-02",
        realToday: REAL_TODAY,
      });
      expect(t.seedTime).toBe("21:30");
    });

    it("falls back to the conversation time when no own time", () => {
      const t = proposalTime({
        capturedAt: undefined,
        fallbackTime: "12:30",
        viewedDate: "2026-08-02",
        realToday: REAL_TODAY,
      });
      expect(t.seedTime).toBe("12:30");
    });

    it("seeds noon when viewing a past day and no time is available", () => {
      const t = proposalTime({
        capturedAt: undefined,
        viewedDate: "2026-07-30", // not realToday
        realToday: REAL_TODAY,
      });
      expect(t.seedTime).toBe("12:00");
    });

    it("seeds a real HH:MM (now) when viewing today with no time available", () => {
      const t = proposalTime({
        capturedAt: undefined,
        viewedDate: REAL_TODAY,
        realToday: REAL_TODAY,
      });
      expect(t.seedTime).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  describe("composeAt", () => {
    it("pins to the item's OWN captured date, ignoring viewedDate", () => {
      const t = proposalTime({
        capturedAt: "2026-08-01T21:30:00",
        viewedDate: "2026-08-02",
        realToday: REAL_TODAY,
      });
      // Even with an edited time, the captured date is preserved.
      expect(t.composeAt("22:15")).toBe("2026-08-01T22:15:00");
    });

    it("pins to the fallback date when there's no own date", () => {
      const t = proposalTime({
        capturedAt: undefined,
        fallbackDate: "2026-07-31",
        viewedDate: "2026-08-02",
        realToday: REAL_TODAY,
      });
      expect(t.composeAt("18:00")).toBe("2026-07-31T18:00:00");
    });

    it("falls back to composeEatenAt (viewedDate + 4am rollover) with no captured/fallback date", () => {
      const t = proposalTime({
        capturedAt: undefined,
        viewedDate: "2026-08-02",
        realToday: REAL_TODAY,
      });
      // A 2am time rolls onto the next calendar day per the 4am day-start rule.
      expect(t.composeAt("02:00")).toBe("2026-08-03T02:00:00");
      // A daytime time stays on viewedDate.
      expect(t.composeAt("13:00")).toBe("2026-08-02T13:00:00");
    });

    it("does NOT apply the 4am rollover when pinning to a captured date", () => {
      // The rollover only applies on the composeEatenAt (viewedDate) branch. With
      // a captured date, a pre-4am edited time must stay on THAT date, not shift.
      const t = proposalTime({
        capturedAt: "2026-08-01T21:30:00",
        viewedDate: "2026-08-02",
        realToday: REAL_TODAY,
      });
      expect(t.composeAt("02:00")).toBe("2026-08-01T02:00:00");
    });

    it("guards a malformed edited time to noon on the pinned date", () => {
      const t = proposalTime({
        capturedAt: "2026-08-01T21:30:00",
        viewedDate: "2026-08-02",
        realToday: REAL_TODAY,
      });
      expect(t.composeAt("")).toBe("2026-08-01T12:00:00");
    });
  });
});
