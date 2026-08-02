import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetWorkoutTool } from "./get-workout.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_workout", () => {
  it("GETs /api/v1/workouts/:id and returns the workout", async () => {
    const workout = {
      id: 42,
      started_at: "2026-05-10T17:00:00Z",
      title: "Push",
      exercise_instances: [{ id: 1, sets: [] }],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, workout));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({ id: 42 });
    expect(result).toEqual(workout);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/workouts/42");
    expect(nthCall(fetchImpl, 0)[1].method).toBe("GET");
  });

  it("rejects non-positive ids via zod schema", () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    expect(() => tool.inputSchema.parse({ id: 0 })).toThrow();
    expect(() => tool.inputSchema.parse({ id: -1 })).toThrow();
  });
});
