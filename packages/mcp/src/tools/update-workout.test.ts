import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeUpdateWorkoutTool } from "./update-workout.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("update_workout", () => {
  it("PATCHes to /api/v1/workouts/:id with only the provided fields and returns the new state", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, {
        id: 7,
        template_id: 2,
        started_at: "2026-05-12T17:00:00Z",
        duration_min: 60,
        rpe: 8,
        est_kcal: 400,
        notes: "good session",
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({ id: 7, rpe: 8 });
    const r = result as { workout: { id: number; rpe: number } };
    expect(r.workout.id).toBe(7);
    expect(r.workout.rpe).toBe(8);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/workouts/7");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ rpe: 8 });
    // No idempotency key on PATCH.
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 404 from the API when the id doesn't exist", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(404, { error: { code: "not_found", message: "Workout 999 not found" } }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ id: 999, rpe: 8 })).rejects.toThrow(/404/);
  });
});
