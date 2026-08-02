import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeUpdateWeightTool } from "./update-weight.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("update_weight", () => {
  it("PATCHes to /api/v1/body-weights/:id with only the provided fields and returns the new state", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, { id: 3, weight_kg: 82.5, measured_on: "2026-05-12", notes: null }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateWeightTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({ id: 3, weight_kg: 82.5 });
    const r = result as { body_weight: { id: number; weight_kg: number } };
    expect(r.body_weight.id).toBe(3);
    expect(r.body_weight.weight_kg).toBe(82.5);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/body-weights/3");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ weight_kg: 82.5 });
    // No idempotency key on PATCH.
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 404 from the API when the id doesn't exist", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(404, {
        error: { code: "not_found", message: "Body-weight 999 not found" },
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateWeightTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ id: 999, weight_kg: 82.5 })).rejects.toThrow(/404/);
  });
});
