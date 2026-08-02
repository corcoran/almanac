import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeDefineStoredMealTool } from "./define-stored-meal.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("define_stored_meal", () => {
  it("POSTs to /api/v1/stored-meals and returns the saved definition", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(201, {
        id: 7,
        name: "breakfast",
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
        description: "eggs",
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeDefineStoredMealTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({
      name: "breakfast",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
      description: "eggs",
    })) as { stored_meal: { id: number; name: string } };
    expect(result.stored_meal.id).toBe(7);
    expect(result.stored_meal.name).toBe("breakfast");
    // fetchImpl(url, init) — 2 args. The POST targets /stored-meals.
    expect(String(nthCall(fetchImpl, 0)[0])).toContain("/api/v1/stored-meals");
  });
});
