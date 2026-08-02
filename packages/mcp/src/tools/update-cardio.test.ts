import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeUpdateCardioTool } from "./update-cardio.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("update_cardio", () => {
  it("PATCHes to /api/v1/cardio-sessions/:id with only the provided fields and returns the new state", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, {
        id: 9,
        started_at: "2026-05-12T06:00:00Z",
        duration_min: 45,
        modality: "run",
        avg_hr: 150,
        distance_km: 8,
        est_kcal: 500,
        notes: null,
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateCardioTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({ id: 9, est_kcal: 500 });
    const r = result as { cardio: { id: number; est_kcal: number } };
    expect(r.cardio.id).toBe(9);
    expect(r.cardio.est_kcal).toBe(500);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/cardio-sessions/9");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ est_kcal: 500 });
    // No idempotency key on PATCH.
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 404 from the API when the id doesn't exist", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(404, {
        error: { code: "not_found", message: "Cardio-session 999 not found" },
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateCardioTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ id: 999, est_kcal: 500 })).rejects.toThrow(/404/);
  });
});
