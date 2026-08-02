import { at, nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetPhaseHistoryTool } from "./get-phase-history.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_phase_history", () => {
  it("GETs /api/v1/nutrition-phases and returns phases + count (current phase has TDEE fields, historical phase has nulls)", async () => {
    const phases = [
      // Active phase post-refactor — all four TDEE fields populated.
      {
        id: 1,
        name: "cut",
        intent: "cut",
        phase_type: "cut",
        tdee_at_phase_start: 2400,
        tdee_source: "user_asserted",
        deficit_kcal: -500,
        daily_kcal_target: 1900,
        started_on: "2026-05-01",
        ended_on: null,
      },
      // Historical phase predating migration 006 — TDEE fields are null but
      // `daily_kcal_target` is non-null (it's the rename of legacy base_kcal).
      {
        id: 2,
        name: "maintain",
        intent: "maintenance",
        phase_type: null,
        tdee_at_phase_start: null,
        tdee_source: null,
        deficit_kcal: null,
        daily_kcal_target: 2400,
        started_on: "2026-03-01",
        ended_on: "2026-04-30",
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, phases));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetPhaseHistoryTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({});
    const r = result as {
      phases: Array<{
        phase_type: string | null;
        tdee_at_phase_start: number | null;
        tdee_source: string | null;
        deficit_kcal: number | null;
        daily_kcal_target: number;
      }>;
      count: number;
    };
    expect(r.phases).toEqual(phases);
    expect(r.count).toBe(2);
    // The active phase carries the new TDEE-refactor fields...
    expect(at(r.phases, 0).phase_type).toBe("cut");
    expect(at(r.phases, 0).tdee_at_phase_start).toBe(2400);
    expect(at(r.phases, 0).tdee_source).toBe("user_asserted");
    expect(at(r.phases, 0).deficit_kcal).toBe(-500);
    // ...while the historical phase carries nulls on those four, but a
    // non-null `daily_kcal_target` (the migrated `base_kcal` rename).
    expect(at(r.phases, 1).phase_type).toBeNull();
    expect(at(r.phases, 1).tdee_at_phase_start).toBeNull();
    expect(at(r.phases, 1).tdee_source).toBeNull();
    expect(at(r.phases, 1).deficit_kcal).toBeNull();
    expect(at(r.phases, 1).daily_kcal_target).toBe(2400);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/nutrition-phases");
  });
});
