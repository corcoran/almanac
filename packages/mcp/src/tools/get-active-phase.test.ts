import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetActivePhaseTool } from "./get-active-phase.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_active_phase", () => {
  it("returns the active phase when present", async () => {
    const phase = {
      id: 1,
      name: "cut",
      intent: "cut",
      phase_type: "cut",
      tdee_at_phase_start: 2400,
      tdee_source: "user_asserted",
      deficit_kcal: -500,
      daily_kcal_target: 1900,
      started_on: "2026-05-01",
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, phase));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetActivePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({});
    expect(result).toEqual(phase);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/nutrition-phases/active");
  });

  it("returns a friendly error object when the API responds 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(404, {
        error: { code: "not_found", message: "No active nutrition phase" },
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetActivePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({});
    const r = result as { error: string };
    expect(r.error).toContain("No active nutrition phase");
    expect(r.error).toContain("start_nutrition_phase");
  });

  it("rethrows non-404 errors", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(500, { error: { message: "boom" } }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetActivePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await expect(tool.handler({})).rejects.toThrow(/500/);
  });
});
