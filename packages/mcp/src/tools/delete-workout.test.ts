import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeDeleteWorkoutTool } from "./delete-workout.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

/**
 * Canonical delete-tool test. The other six delete_* tools all share the
 * same shape (id field + confirm:true literal + DELETE call against an
 * /:id path) so this one stands in for the family. If we ever change the
 * delete contract — adding a soft-delete column, requiring a reason, etc.
 * — the per-tool tests will fan out then.
 */
describe("delete_workout", () => {
  it("DELETEs /api/v1/workouts/:id and returns {deleted, workout_id}", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(204, ""));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeDeleteWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({ workout_id: 42, confirm: true });

    expect(result).toEqual({ deleted: true, workout_id: 42 });
    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url).toBe("http://x/api/v1/workouts/42");
    const init = nthCall(fetchImpl, 0)[1] as RequestInit;
    expect(init.method).toBe("DELETE");
  });

  it("rejects calls without confirm: true at the schema level", () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeDeleteWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    // confirm must be the LITERAL true — Zod rejects undefined, false, "true".
    expect(tool.inputSchema.safeParse({ workout_id: 42 }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ workout_id: 42, confirm: false }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ workout_id: 42, confirm: "true" }).success).toBe(false);

    // No fetch should have happened — schema validation is the gate.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("advertises destructiveHint: true so clients prompt before invoking", () => {
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() });
    const tool = makeDeleteWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.annotations?.readOnlyHint).toBe(false);
  });
});
