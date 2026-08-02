import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeUpdateMealTool } from "./update-meal.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("update_meal", () => {
  it("PATCHes to /api/v1/meals/:id with only the provided fields and returns the new state", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, {
        id: 5,
        kcal: 600,
        protein_g: 30,
        carb_g: 50,
        fat_g: 20,
        eaten_at: "2026-05-12T08:00:00Z",
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateMealTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({ id: 5, kcal: 600 });
    const r = result as { meal: { id: number; kcal: number } };
    expect(r.meal.id).toBe(5);
    expect(r.meal.kcal).toBe(600);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/meals/5");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ kcal: 600 });
    // No idempotency key on PATCH.
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 404 from the API when the id doesn't exist", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(404, { error: { code: "not_found", message: "Meal 999 not found" } }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateMealTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ id: 999, kcal: 600 })).rejects.toThrow(/404/);
  });
});
