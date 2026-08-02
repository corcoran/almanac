import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetMacrosTodayTool } from "./get-macros-today.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

const sampleObserved = {
  cardio_kcal: 100,
  workout_kcal: 200,
  vs_target: -800, // 1100 - 1900
  vs_maintenance: -1250, // 1100 - 2350
  status: "on_track" as const,
};

describe("get_macros_today", () => {
  it("projects the new {target, maintenance, intake, observed} shape and emits pct + summary", async () => {
    const today = {
      today: {
        kcal_in: 1100,
        protein_g_in: 78,
        carb_g_in: 100,
        fat_g_in: 30,
        target: { kcal: 1900, protein_g: 180, carb_g: 170, fat_g: 60 },
        maintenance: { kcal: 2350 },
        intake: { kcal: 1100, protein_g: 78, carb_g: 100, fat_g: 30 },
        observed: sampleObserved,
        meals_logged_today: true,
      },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, today));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosTodayTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({});
    const r = result as {
      kcal_in: number;
      kcal_target: number | null;
      pct: number | null;
      protein_g_in: number;
      carb_g_in: number;
      fat_g_in: number;
      protein_g_target: number | null;
      carb_g_target: number | null;
      fat_g_target: number | null;
      maintenance_kcal: number | null;
      observed: typeof sampleObserved | null;
      summary: string;
    };
    expect(r.kcal_in).toBe(1100);
    expect(r.kcal_target).toBe(1900);
    expect(r.pct).toBe(58);
    expect(r.protein_g_in).toBe(78);
    expect(r.carb_g_in).toBe(100);
    expect(r.fat_g_in).toBe(30);
    expect(r.protein_g_target).toBe(180);
    expect(r.carb_g_target).toBe(170);
    expect(r.fat_g_target).toBe(60);
    expect(r.maintenance_kcal).toBe(2350);
    expect(r.observed).toEqual(sampleObserved);
    expect(r.summary).toContain("1100/1900");
    expect(r.summary).toContain("58%");
    // Full P/C/F intake + per-macro targets in the summary line.
    expect(r.summary).toContain("78p / 100c / 30f");
    expect(r.summary).toContain("180p / 170c / 60f");
    // Baked-in status verdict (Follow-up C) — on_track fixture above.
    expect(r.summary).toContain("on track");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/signals/today");
  });

  // Status phrase coverage — pin each verdict so the wording is locked.
  // Fixtures use target 1900 / TDEE 2370 (cut, grace = 237 → on_track ≤ 2137,
  // at_risk 2138–2369, off_track ≥ 2370). The summary derives its phrase
  // directly from `observed.status` so we can feed any status without
  // re-justifying the math here.
  it.each([
    ["on_track", "on track"],
    ["at_risk", "at risk (close to maintenance)"],
    ["off_track", "off track"],
  ] as const)("summary includes %s phrase when observed.status = %s", async (status, phrase) => {
    const today = {
      today: {
        kcal_in: 2200,
        protein_g_in: 150,
        target: { kcal: 1900, protein_g: 180, carb_g: 170, fat_g: 60 },
        maintenance: { kcal: 2370 },
        intake: { kcal: 2200, protein_g: 150, carb_g: 200, fat_g: 70 },
        observed: { ...sampleObserved, status },
        meals_logged_today: true,
      },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, today));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosTodayTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({})) as { summary: string };
    expect(r.summary).toContain(phrase);
  });

  it("when no nutrition phase is active, returns null targets + a no-phase summary (no NaN, no status phrase)", async () => {
    const today = {
      today: {
        kcal_in: 1200,
        protein_g_in: 90,
        carb_g_in: 120,
        fat_g_in: 40,
        target: null,
        maintenance: null,
        intake: { kcal: 1200, protein_g: 90, carb_g: 120, fat_g: 40 },
        observed: null,
        meals_logged_today: true,
      },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, today));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosTodayTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = (await tool.handler({})) as {
      kcal_target: number | null;
      pct: number | null;
      observed: unknown | null;
      maintenance_kcal: number | null;
      summary: string;
    };
    expect(result.kcal_target).toBeNull();
    expect(result.pct).toBeNull();
    expect(result.observed).toBeNull();
    expect(result.maintenance_kcal).toBeNull();
    expect(result.summary).toContain("no active nutrition phase");
    // Full P/C/F intake is surfaced even without a phase target.
    expect(result.summary).toContain("90p / 120c / 40f");
    // No status phrase when there's no phase to evaluate against.
    expect(result.summary).not.toMatch(/on track|at risk|off track/);
  });

  it("when no meals are logged today, summary reads 'no meals logged' instead of '0 kcal in'", async () => {
    // Phase exists, but the user hasn't logged any meals today (vacation,
    // intermittent logger, etc.). Without the data-presence flag the
    // summary would read "Today: 0/1900 kcal (0%) — off track, 0p" and an
    // LLM would surface that as if the user fasted. With the flag, the
    // summary explicitly says no meals were logged.
    const today = {
      today: {
        kcal_in: 0,
        protein_g_in: 0,
        target: { kcal: 1900, protein_g: 180, carb_g: 200, fat_g: 65 },
        maintenance: { kcal: 2200 },
        intake: { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 },
        observed: {
          cardio_kcal: 0,
          workout_kcal: 0,
          vs_target: -1900,
          vs_maintenance: -2200,
          status: "off_track" as const,
        },
        meals_logged_today: false,
      },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, today));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMacrosTodayTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = (await tool.handler({})) as { summary: string };
    expect(result.summary).toMatch(/no meals logged/i);
    // The literal "0 kcal" copy should NOT appear — it's the misleading
    // surface the flag is designed to suppress.
    expect(result.summary).not.toMatch(/0\/1900 kcal/);
  });
});
