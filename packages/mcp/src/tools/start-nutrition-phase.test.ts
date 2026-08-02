import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { ToolError } from "../tool.js";
import { makeStartNutritionPhaseTool } from "./start-nutrition-phase.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

const baseInput = {
  name: "2026 Spring cut",
  intent: "cut" as const,
  phase_type: "cut" as const,
  base_protein_g: 180,
  base_carb_g: 200,
  base_fat_g: 70,
  started_on: "2026-05-12",
};

describe("start_nutrition_phase", () => {
  it("POSTs to /api/v1/nutrition-phases with the input body and returns the created phase (with tdee_override)", async () => {
    const created = {
      id: 9,
      user_id: 1,
      name: "2026 Spring cut",
      intent: "cut",
      phase_type: "cut",
      tdee_at_phase_start: 2400,
      tdee_source: "user_asserted",
      deficit_kcal: -500,
      daily_kcal_target: 1900,
      base_protein_g: 180,
      base_carb_g: 200,
      base_fat_g: 70,
      started_on: "2026-05-12",
      planned_end_on: null,
      ended_on: null,
      notes: null,
      created_at: "2026-05-12T08:00:00Z",
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(201, created));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeStartNutritionPhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const body = {
      ...baseInput,
      tdee_override: 2400,
      deficit_kcal: -500,
    };
    const result = await tool.handler(body);
    const r = result as { phase: { id: number; name: string; tdee_source: string } };
    expect(r.phase.id).toBe(9);
    expect(r.phase.tdee_source).toBe("user_asserted");
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/nutrition-phases");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual(body);
  });

  it("succeeds with a computed TDEE (no override) — surfaces tdee_source: 'formula'", async () => {
    const created = {
      id: 10,
      user_id: 1,
      name: "2026 Spring cut",
      intent: "cut",
      phase_type: "cut",
      tdee_at_phase_start: 2350,
      tdee_source: "formula",
      deficit_kcal: -450,
      daily_kcal_target: 1900,
      base_protein_g: 180,
      base_carb_g: 200,
      base_fat_g: 70,
      started_on: "2026-05-12",
      planned_end_on: null,
      ended_on: null,
      notes: null,
      created_at: "2026-05-12T08:00:00Z",
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(201, created));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeStartNutritionPhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({
      ...baseInput,
      daily_kcal_target: 1900,
    });
    const r = result as { phase: { tdee_source: string; daily_kcal_target: number } };
    expect(r.phase.tdee_source).toBe("formula");
    expect(r.phase.daily_kcal_target).toBe(1900);
  });

  it("cold-start: surfaces the structured 422 tdee_unavailable envelope as a ToolError (isError content)", async () => {
    const envelope = {
      error: "tdee_unavailable",
      reason: "no_measured_tdee_yet",
      required_action: "provide_tdee_override",
      hints: {
        missing_profile_fields: ["weight_kg"],
        suggestion:
          "Discuss the user's stats, activity level, and goals to land on a TDEE estimate, then call start_nutrition_phase with tdee_override set.",
      },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(422, envelope));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeStartNutritionPhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    try {
      await tool.handler({ ...baseInput, daily_kcal_target: 1900 });
      throw new Error("expected ToolError");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      const payload = (err as ToolError).payload as typeof envelope;
      // Envelope passes through verbatim — no rewrapping.
      expect(payload).toEqual(envelope);
      expect(payload.error).toBe("tdee_unavailable");
      expect(payload.hints.missing_profile_fields).toEqual(["weight_kg"]);
    }
  });

  it("forwards 400 validation_failed (phase-invariant violation) as a ToolError", async () => {
    const errBody = {
      error: {
        code: "validation_failed",
        message: "cut requires deficit_kcal < -120 (5% of TDEE 2400)",
      },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(400, errBody));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeStartNutritionPhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    try {
      await tool.handler({
        ...baseInput,
        tdee_override: 2400,
        deficit_kcal: -50, // too small for a cut on TDEE 2400
      });
      throw new Error("expected ToolError");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).payload).toEqual(errBody);
    }
  });

  it("input schema requires either deficit_kcal or daily_kcal_target", () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeStartNutritionPhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    // Use the inputSchema to validate — matches dispatcher behavior.
    const parsed = tool.inputSchema.safeParse({ ...baseInput, tdee_override: 2400 });
    expect(parsed.success).toBe(false);
  });

  it("propagates non-4xx errors (e.g. 500) untouched", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(500, { error: { message: "boom" } }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeStartNutritionPhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(
      tool.handler({ ...baseInput, tdee_override: 2400, deficit_kcal: -500 }),
    ).rejects.toThrow(/500/);
  });
});
