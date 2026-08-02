import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeDefineExerciseGroupTool } from "./define-exercise-group.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("define_exercise_group", () => {
  it("POSTs to /api/v1/exercise-groups with the input body and returns the created group", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(201, {
        id: 7,
        user_id: 1,
        name: "Push",
        display_order: 0,
        created_at: "2026-05-12T08:00:00Z",
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeDefineExerciseGroupTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({ name: "Push", display_order: 0 });
    const r = result as { exercise_group: { id: number; name: string; display_order: number } };
    expect(r.exercise_group.id).toBe(7);
    expect(r.exercise_group.name).toBe("Push");
    expect(r.exercise_group.display_order).toBe(0);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/exercise-groups");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({ name: "Push", display_order: 0 });
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 422 from the API when the name is invalid", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(422, { error: { code: "validation_failed", message: "Name required" } }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeDefineExerciseGroupTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ name: "Push" })).rejects.toThrow(/422/);
  });
});
