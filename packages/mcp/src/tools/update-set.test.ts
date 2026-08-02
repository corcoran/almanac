import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeUpdateSetTool } from "./update-set.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("update_set", () => {
  it("PATCHes to /api/v1/sets/:id with only the provided fields and returns the new state", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, { id: 12, reps: 10, weight_kg: 80, notes: null }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateSetTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({ id: 12, weight_kg: 80 });
    const r = result as { set: { id: number; weight_kg: number } };
    expect(r.set.id).toBe(12);
    expect(r.set.weight_kg).toBe(80);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/sets/12");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ weight_kg: 80 });
    // No idempotency key on PATCH.
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 404 from the API when the id doesn't exist", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(404, { error: { code: "not_found", message: "Set 999 not found" } }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateSetTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ id: 999, weight_kg: 80 })).rejects.toThrow(/404/);
  });
});
