import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeUpdateStoredMealTool } from "./update-stored-meal.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("update_stored_meal", () => {
  it("PATCHes /api/v1/stored-meals/:id with the patch and returns the row", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, {
        id: 7,
        name: "weekday breakfast",
        kcal: 400,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
        description: null,
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateStoredMealTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({
      stored_meal_id: 7,
      name: "weekday breakfast",
      kcal: 400,
    })) as {
      stored_meal: { name: string; kcal: number };
    };
    expect(result.stored_meal.name).toBe("weekday breakfast");
    expect(result.stored_meal.kcal).toBe(400);
    // ApiClient calls fetchImpl(url, init) — 2 args (verified in client.ts).
    // nthCall(fetchImpl, 0) returns that args array: [url, init].
    const call = nthCall(fetchImpl, 0);
    expect(String(call[0])).toContain("/api/v1/stored-meals/7");
    // The id must NOT be forwarded in the PATCH body.
    const sentBody = JSON.parse(String((call[1] as { body?: string }).body ?? "{}"));
    expect(sentBody.stored_meal_id).toBeUndefined();
  });
});
