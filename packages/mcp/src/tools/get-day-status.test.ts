import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetDayStatusTool } from "./get-day-status.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

const baseDayStatus = {
  date: "2026-05-21",
  summary: {
    kcal_in: 1500,
    kcal_target: 1900,
    kcal_delta: -400,
    protein_g_in: 130,
    protein_g_target: 180,
    energy_balance: {
      food_in: 1500,
      alcohol_in: 0,
      total_in: 1500,
      tdee_baseline: 2389,
      cardio_out: 0,
      workout_out: 0,
      net: -889,
    },
    workout_done: false,
    sleep_logged: true,
    weight_logged: true,
    alcohol_logged: false,
    meals_logged: true,
    status: "on_track" as const,
  },
  nudges: [
    {
      code: "no_workout_streak",
      severity: "warn",
      message: "No workout logged in 8 days. Last session: 2026-05-13.",
      details: { days_since_last: 8 },
    },
  ],
};

describe("get_day_status", () => {
  it("GETs /api/v1/signals/day-status and returns the day-status body plus a summary_line", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, baseDayStatus));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetDayStatusTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = (await tool.handler({})) as typeof baseDayStatus & { summary_line: string };

    // Pass-through of structured fields.
    expect(result.date).toBe("2026-05-21");
    expect(result.summary).toEqual(baseDayStatus.summary);
    expect(result.nudges).toEqual(baseDayStatus.nudges);
    // Summary line: date, kcal-vs-target, pct, status phrase, protein.
    expect(result.summary_line).toContain("2026-05-21");
    expect(result.summary_line).toContain("1500/1900");
    expect(result.summary_line).toContain("79%");
    expect(result.summary_line).toContain("on track");
    expect(result.summary_line).toContain("130");
    // Only one fetch call now (day-status only, no /today).
    expect(fetchImpl.mock.calls).toHaveLength(1);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/signals/day-status");
  });

  // Status phrase coverage — each verdict locked. The summary line sources
  // its phrase directly from day-status `summary.status`, so the intake
  // numbers here don't need to justify a specific phase math — the API
  // surface determines the verdict.
  it.each([
    ["on_track", "on track"],
    ["at_risk", "at risk (close to maintenance)"],
    ["off_track", "off track"],
  ] as const)("summary_line includes %s phrase when day-status summary.status = %s", async (status, phrase) => {
    const dayStatusWithStatus = {
      ...baseDayStatus,
      summary: { ...baseDayStatus.summary, status },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, dayStatusWithStatus));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetDayStatusTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({})) as { summary_line: string };
    expect(r.summary_line).toContain(phrase);
  });

  it("when no meals are logged today, summary_line reads 'no meals logged' instead of '0/X kcal'", async () => {
    // Phase exists but no meals today. Without the flag the line would
    // read "2026-05-21: 0/1900 kcal (0%) — off track, 0p / target 180p" —
    // technically the math, but misleading to an LLM consumer that hasn't
    // distinguished "didn't log" from "ate zero".
    const noMealsDayStatus = {
      ...baseDayStatus,
      summary: {
        ...baseDayStatus.summary,
        kcal_in: 0,
        kcal_delta: -1900,
        protein_g_in: 0,
        meals_logged: false,
        status: "off_track" as const,
      },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, noMealsDayStatus));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetDayStatusTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({})) as { summary_line: string };
    expect(r.summary_line).toContain("2026-05-21");
    expect(r.summary_line).toMatch(/no meals logged/i);
    // The misleading "0/1900 kcal" copy must not appear.
    expect(r.summary_line).not.toMatch(/0\/1900 kcal/);
  });

  it("omits the status phrase when no active phase (day-status kcal_target = 0)", async () => {
    const noPhaseDayStatus = {
      ...baseDayStatus,
      summary: {
        ...baseDayStatus.summary,
        kcal_target: 0,
        kcal_delta: 0,
        protein_g_target: 0,
        status: null,
      },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, noPhaseDayStatus));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetDayStatusTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({})) as { summary_line: string };
    expect(r.summary_line).toContain("2026-05-21");
    expect(r.summary_line).toMatch(/no active nutrition phase/i);
    expect(r.summary_line).not.toMatch(/on track|at risk|off track/);
  });
});
