import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeDeleteStoredMealTool } from "./delete-stored-meal.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("delete_stored_meal", () => {
  it("DELETEs /api/v1/stored-meals/:id and returns deleted:true", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(204, null));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeDeleteStoredMealTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({ stored_meal_id: 7, confirm: true })) as {
      deleted: boolean;
      stored_meal_id: number;
    };
    expect(result.deleted).toBe(true);
    expect(result.stored_meal_id).toBe(7);
    const call = nthCall(fetchImpl, 0);
    expect(String(call[0])).toContain("/api/v1/stored-meals/7");
    expect((call[1] as { method?: string }).method).toBe("DELETE");
  });

  it("rejects without confirm:true at the schema layer", () => {
    const tool = makeDeleteStoredMealTool({
      api: new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() }),
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    expect(tool.inputSchema.safeParse({ stored_meal_id: 7 }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ stored_meal_id: 7, confirm: false }).success).toBe(false);
  });

  it("is annotated destructive", () => {
    const tool = makeDeleteStoredMealTool({
      api: new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() }),
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    expect(tool.annotations?.destructiveHint).toBe(true);
  });
});
