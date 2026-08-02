import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeListExerciseGroupsTool } from "./list-exercise-groups.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("list_exercise_groups", () => {
  it("GETs /api/v1/exercise-groups and returns the array", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, [
        { id: 1, user_id: 1, name: "Push", display_order: 0, created_at: "2026-05-12T08:00:00Z" },
        { id: 2, user_id: 1, name: "Pull", display_order: 1, created_at: "2026-05-12T08:00:00Z" },
      ]),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeListExerciseGroupsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({})) as {
      exercise_groups: Array<{ id: number; name: string }>;
    };
    expect(result.exercise_groups).toHaveLength(2);
    expect(result.exercise_groups[0]?.name).toBe("Push");
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/exercise-groups");
    expect(call[1].method).toBe("GET");
  });
});
