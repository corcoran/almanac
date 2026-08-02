import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makePhaseCurrentResource } from "./phase-current.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("almanac://phase/current resource", () => {
  it("GETs /api/v1/nutrition-phases/active and serializes to JSON", async () => {
    const phase = {
      id: 4,
      name: "cut",
      intent: "cut",
      phase_type: "cut",
      tdee_at_phase_start: 2400,
      tdee_source: "user_asserted",
      deficit_kcal: -500,
      daily_kcal_target: 1900,
      base_protein_g: 180,
      started_on: "2026-05-01",
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, phase));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const resource = makePhaseCurrentResource({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    expect(resource.uri).toBe("almanac://phase/current");
    expect(resource.mimeType).toBe("application/json");

    const body = await resource.handler();
    expect(JSON.parse(body)).toEqual(phase);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/nutrition-phases/active");
  });

  it("returns 'null' when no active phase exists (404 from API)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(404, { error: { code: "not_found", message: "No active phase" } }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const resource = makePhaseCurrentResource({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const body = await resource.handler();
    expect(body).toBe("null");
  });
});
