import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeListStoredMealsTool } from "./list-stored-meals.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("list_stored_meals", () => {
  it("GETs /api/v1/stored-meals and returns the list + count", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, [
        {
          id: 1,
          name: "breakfast",
          kcal: 350,
          protein_g: 25,
          carb_g: 30,
          fat_g: 15,
          description: null,
        },
        {
          id: 2,
          name: "lunch",
          kcal: 600,
          protein_g: 40,
          carb_g: 50,
          fat_g: 20,
          description: null,
        },
      ]),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeListStoredMealsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({})) as { stored_meals: unknown[]; count: number };
    expect(result.count).toBe(2);
    expect(result.stored_meals).toHaveLength(2);
    expect(String(nthCall(fetchImpl, 0)[0])).toContain("/api/v1/stored-meals");
  });
});
