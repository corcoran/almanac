import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeUpdateStepsTool, UpdateStepsInputSchema } from "./update-steps.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("update_steps", () => {
  it("PATCHes to /api/v1/step-logs/:id with only the provided fields and returns the new state", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, {
        id: 4,
        on_date: "2026-05-11",
        steps: 9000,
        est_kcal: 360,
        notes: null,
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateStepsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({ id: 4, steps: 9000 });
    const r = result as { step_log: { id: number; steps: number } };
    expect(r.step_log.id).toBe(4);
    expect(r.step_log.steps).toBe(9000);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/step-logs/4");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ steps: 9000 });
    // No idempotency key on PATCH.
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 404 from the API when the id doesn't exist", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(404, { error: { code: "not_found", message: "Step log 999 not found" } }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateStepsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ id: 999, steps: 9000 })).rejects.toThrow(/404/);
  });
});

describe("UpdateStepsInputSchema bounds", () => {
  it("rejects a zero step count", () => {
    expect(UpdateStepsInputSchema.safeParse({ id: 4, steps: 0 }).success).toBe(false);
  });

  it("accepts a one-step count", () => {
    expect(UpdateStepsInputSchema.safeParse({ id: 4, steps: 1 }).success).toBe(true);
  });
});
