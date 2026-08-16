import { at, defined, nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetMacrosRangeTool } from "./get-macros-range.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

function makeDayTarget(target_kcal: number, intake_kcal: number) {
  return {
    target: { kcal: target_kcal, protein_g: 165, carb_g: 230, fat_g: 75 },
    maintenance: { kcal: target_kcal + 500 },
    intake: { kcal: intake_kcal, protein_g: 100, carb_g: 100, fat_g: 50 },
    observed: {
      cardio_kcal: 0,
      workout_kcal: 0,
      vs_target: intake_kcal - target_kcal,
      vs_maintenance: intake_kcal - (target_kcal + 500),
      status: "on_track" as const,
    },
  };
}

function makeDay(date: string, kcal: number, day_target: unknown | null, untracked = false) {
  return {
    date,
    day_totals: {
      kcal,
      protein_g: 100,
      carb_g: 100,
      fat_g: 50,
      kcal_from_food: kcal,
      kcal_from_alcohol: 0,
    },
    day_target,
    untracked,
  };
}

describe("get_macros_range", () => {
  it("forwards from_date and to_date to /api/v1/signals/macros and returns days[] with the new day_target shape", async () => {
    const apiResponse = {
      days: [
        makeDay("2026-05-08", 1798, makeDayTarget(1900, 1798)),
        makeDay("2026-05-09", 2100, makeDayTarget(1900, 2100)),
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, apiResponse));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosRangeTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({ from_date: "2026-05-08", to_date: "2026-05-09" })) as {
      days: Array<{ date: string; day_target: { target: { kcal: number } } | null }>;
      avg_kcal_in_over_range: number | null;
    };
    expect(r.days).toHaveLength(2);
    expect(defined(at(r.days, 0).day_target, "day_target").target.kcal).toBe(1900);
    // Both days have a phase active → avg of 1798 and 2100.
    expect(r.avg_kcal_in_over_range).toBe((1798 + 2100) / 2);
    expect(nthCall(fetchImpl, 0)[0]).toBe(
      "http://x/api/v1/signals/macros?from_date=2026-05-08&to_date=2026-05-09",
    );
  });

  it("range average skips days with no active phase (day_target: null) so they don't dilute the mean", async () => {
    const apiResponse = {
      days: [
        // Two no-phase days at the start — should NOT count in the average.
        makeDay("2026-05-01", 1000, null),
        makeDay("2026-05-02", 1100, null),
        // Two with-phase days — these are what the average should reflect.
        makeDay("2026-05-03", 2000, makeDayTarget(1900, 2000)),
        makeDay("2026-05-04", 2200, makeDayTarget(1900, 2200)),
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, apiResponse));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosRangeTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({ from_date: "2026-05-01", to_date: "2026-05-04" })) as {
      avg_kcal_in_over_range: number | null;
    };
    expect(r.avg_kcal_in_over_range).toBe((2000 + 2200) / 2);
  });

  it("excludes untracked days from avg_kcal_in_over_range", async () => {
    const apiResponse = {
      days: [
        // Tracked days at 2000 kcal — these define the expected mean.
        makeDay("2026-05-01", 2000, makeDayTarget(1900, 2000)),
        makeDay("2026-05-02", 2000, makeDayTarget(1900, 2000)),
        // In-window untracked (vacation) day at a divergent 200 kcal. It carries
        // a day_target, so filtering on a null target alone would not exclude it.
        makeDay("2026-05-03", 200, makeDayTarget(1900, 200), true),
        makeDay("2026-05-04", 2000, makeDayTarget(1900, 2000)),
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, apiResponse));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosRangeTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({ from_date: "2026-05-01", to_date: "2026-05-04" })) as {
      avg_kcal_in_over_range: number | null;
    };
    // Tracked-only mean of the three 2000-kcal days, NOT the untracked-inclusive
    // mean ((2000 + 2000 + 200 + 2000) / 4 = 1550).
    expect(r.avg_kcal_in_over_range).toBe(2000);
  });

  it("range average is null when every day has no active phase", async () => {
    const apiResponse = {
      days: [makeDay("2026-05-01", 1000, null), makeDay("2026-05-02", 1100, null)],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, apiResponse));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosRangeTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({ from_date: "2026-05-01", to_date: "2026-05-02" })) as {
      avg_kcal_in_over_range: number | null;
    };
    expect(r.avg_kcal_in_over_range).toBeNull();
  });

  it("reports the true denominator on a range shorter than a week", async () => {
    // The reported bug: a 3-day query returned a 3-day mean under a `7d` name,
    // which reads as a week. The average is right; `days_in_avg` is what makes
    // it legible.
    const apiResponse = {
      days: [
        makeDay("2026-05-01", 2000, makeDayTarget(1900, 2000)),
        makeDay("2026-05-02", 2400, makeDayTarget(1900, 2400)),
        makeDay("2026-05-03", 2589, makeDayTarget(1900, 2589)),
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, apiResponse));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosRangeTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({ from_date: "2026-05-01", to_date: "2026-05-03" })) as {
      avg_kcal_in_over_range: number | null;
      days_in_avg: number;
    };
    expect(r.avg_kcal_in_over_range).toBe((2000 + 2400 + 2589) / 3);
    expect(r.days_in_avg).toBe(3);
  });

  it("caps the average at the 7 most recent qualifying days", async () => {
    // 10 qualifying days: the first three (at 500) must fall outside the window.
    const days = [
      ...[0, 1, 2].map((i) => makeDay(`2026-05-0${i + 1}`, 500, makeDayTarget(1900, 500))),
      ...[3, 4, 5, 6, 7, 8, 9].map((i) =>
        makeDay(`2026-05-0${i + 1}`, 2000, makeDayTarget(1900, 2000)),
      ),
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, { days }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosRangeTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({ from_date: "2026-05-01", to_date: "2026-05-10" })) as {
      avg_kcal_in_over_range: number | null;
      days_in_avg: number;
    };
    expect(r.avg_kcal_in_over_range).toBe(2000);
    expect(r.days_in_avg).toBe(7);
  });
});
