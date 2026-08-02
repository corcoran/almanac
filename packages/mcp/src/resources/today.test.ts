import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeTodayResource } from "./today.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("almanac://today resource", () => {
  it("GETs /api/v1/signals/today and serializes to JSON", async () => {
    const todayCtx = {
      today: {
        kcal_in: 1200,
        protein_g_in: 90,
        // Post-TDEE-refactor: structured target/maintenance/intake/observed.
        target: { kcal: 1900, protein_g: 150, carb_g: 200, fat_g: 60 },
        maintenance: { kcal: 2400 },
        intake: { kcal: 1200, protein_g: 90, carb_g: 120, fat_g: 40 },
        observed: {
          cardio_kcal: 0,
          workout_kcal: 0,
          vs_target: -700,
          vs_maintenance: -1200,
          status: "on_track",
        },
      },
      stim_states: [],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, todayCtx));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const resource = makeTodayResource({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    expect(resource.uri).toBe("almanac://today");
    expect(resource.mimeType).toBe("application/json");

    const body = await resource.handler();
    expect(JSON.parse(body)).toEqual(todayCtx);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/signals/today");
  });
});
