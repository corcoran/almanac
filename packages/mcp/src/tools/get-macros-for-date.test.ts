import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetMacrosForDateTool } from "./get-macros-for-date.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

const sampleDayTarget = {
  target: { kcal: 1900, protein_g: 165, carb_g: 230, fat_g: 75 },
  maintenance: { kcal: 2400 },
  intake: { kcal: 1798, protein_g: 142, carb_g: 180, fat_g: 65 },
  observed: {
    cardio_kcal: 150,
    workout_kcal: 100,
    vs_target: -102,
    vs_maintenance: -602,
    status: "on_track" as const,
  },
};

describe("get_macros_for_date", () => {
  it("forwards date to /api/v1/signals/macros and returns the new day_target shape + summary line", async () => {
    const apiResponse = {
      date: "2026-05-08",
      day_totals: {
        kcal: 1798,
        protein_g: 142,
        carb_g: 180,
        fat_g: 65,
        kcal_from_food: 1798,
        kcal_from_alcohol: 0,
      },
      day_target: sampleDayTarget,
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, apiResponse));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosForDateTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({ date: "2026-05-08" })) as {
      day_totals: { kcal: number; protein_g: number; carb_g: number; fat_g: number };
      day_target: typeof sampleDayTarget;
      summary: string;
    };
    expect(r.day_totals.kcal).toBe(1798);
    // Full P/C/F totals pass through (was previously undocumented).
    expect(r.day_totals.protein_g).toBe(142);
    expect(r.day_totals.carb_g).toBe(180);
    expect(r.day_totals.fat_g).toBe(65);
    expect(r.day_target.target.kcal).toBe(1900);
    expect(r.day_target.maintenance.kcal).toBe(2400);
    expect(r.day_target.observed.status).toBe("on_track");
    // Summary line includes date, kcal-vs-target, pct, status phrase, full P/C/F.
    expect(r.summary).toContain("2026-05-08");
    expect(r.summary).toContain("1798/1900");
    expect(r.summary).toContain("95%");
    expect(r.summary).toContain("on track");
    expect(r.summary).toContain("142p / 180c / 65f");
    expect(r.summary).toContain("165p / 230c / 75f");
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/signals/macros?date=2026-05-08");
  });

  // Status phrase coverage — each verdict locked. Fixtures use target 1900,
  // TDEE 2370 (cut, grace = 237). The summary derives its phrase directly
  // from `day_target.observed.status` so the wording is what's tested here.
  it.each([
    ["on_track", "on track"],
    ["at_risk", "at risk (close to maintenance)"],
    ["off_track", "off track"],
  ] as const)("summary includes %s phrase when observed.status = %s", async (status, phrase) => {
    const apiResponse = {
      date: "2026-05-08",
      day_totals: { kcal: 2200, protein_g: 150, carb_g: 200, fat_g: 70 },
      day_target: {
        target: { kcal: 1900, protein_g: 180, carb_g: 170, fat_g: 60 },
        maintenance: { kcal: 2370 },
        intake: { kcal: 2200, protein_g: 150, carb_g: 200, fat_g: 70 },
        observed: { ...sampleDayTarget.observed, status },
      },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, apiResponse));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosForDateTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({ date: "2026-05-08" })) as { summary: string };
    expect(r.summary).toContain(phrase);
  });

  it("returns day_target: null with no-phase summary when API returns 200 with null target", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, {
        date: "2026-05-08",
        day_totals: {
          kcal: 1500,
          protein_g: 110,
          carb_g: 150,
          fat_g: 50,
          kcal_from_food: 1500,
          kcal_from_alcohol: 0,
        },
        day_target: null,
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosForDateTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({ date: "2026-05-08" })) as {
      day_target: unknown | null;
      summary: string;
    };
    expect(r.day_target).toBeNull();
    expect(r.summary).toContain("2026-05-08");
    expect(r.summary).toMatch(/no.*nutrition phase/i);
    // Full P/C/F totals are surfaced even without a phase target.
    expect(r.summary).toContain("110p / 150c / 50f");
    expect(r.summary).not.toMatch(/on track|at risk|off track/);
  });
});
