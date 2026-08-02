import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeUpdateExerciseTool } from "./update-exercise.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("update_exercise", () => {
  it("PATCHes /api/v1/exercises/:id with only the fields supplied", async () => {
    const updated = {
      id: 7,
      group_id: 2,
      name: "Barbell Bench Press",
      notes: null,
      archived_at: null,
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, updated));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateExerciseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({
      exercise_id: 7,
      name: "Barbell Bench Press",
    });

    expect(result).toEqual({ exercise: updated });
    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url).toBe("http://x/api/v1/exercises/7");
    const init = nthCall(fetchImpl, 0)[1] as RequestInit;
    expect(init.method).toBe("PATCH");
    // Body should NOT include exercise_id — that's a path param, not a field.
    expect(JSON.parse(init.body as string)).toEqual({ name: "Barbell Bench Press" });
  });

  it("supports reassigning group_id and clearing notes", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, {}));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateExerciseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await tool.handler({ exercise_id: 12, group_id: 5, notes: null });

    const init = nthCall(fetchImpl, 0)[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ group_id: 5, notes: null });
  });
});
