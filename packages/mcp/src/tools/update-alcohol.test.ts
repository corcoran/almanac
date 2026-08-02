import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeUpdateAlcoholTool } from "./update-alcohol.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("update_alcohol", () => {
  it("PATCHes to /api/v1/alcohol-sessions/:id with only the provided fields and returns the new state", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, {
        id: 2,
        started_at: "2026-05-11T20:00:00Z",
        ended_at: "2026-05-11T22:30:00Z",
        drinks_count: 3,
        est_kcal: 350,
        notes: null,
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateAlcoholTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({ id: 2, drinks_count: 3 });
    const r = result as { alcohol: { id: number; drinks_count: number } };
    expect(r.alcohol.id).toBe(2);
    expect(r.alcohol.drinks_count).toBe(3);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/alcohol-sessions/2");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ drinks_count: 3 });
    // No idempotency key on PATCH.
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 404 from the API when the id doesn't exist", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(404, {
        error: { code: "not_found", message: "Alcohol-session 999 not found" },
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateAlcoholTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ id: 999, drinks_count: 3 })).rejects.toThrow(/404/);
  });
});
