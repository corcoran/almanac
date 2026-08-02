import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeListWorkoutTemplatesTool } from "./list-workout-templates.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("list_workout_templates", () => {
  it("returns templates with their items inline", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, [
        {
          id: 1,
          user_id: 1,
          name: "PUSH",
          notes: null,
          archived_at: null,
          created_at: "2026-05-12T08:00:00Z",
          items: [
            {
              id: 100,
              template_id: 1,
              exercise_id: 10,
              default_sets: 4,
              default_reps: 6,
              default_weight_kg: 80,
              display_order: 0,
              notes: null,
            },
          ],
        },
      ]),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeListWorkoutTemplatesTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({})) as {
      workout_templates: Array<{ id: number; name: string; items: unknown[] }>;
    };
    expect(result.workout_templates[0]?.name).toBe("PUSH");
    expect(result.workout_templates[0]?.items).toHaveLength(1);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/workout-templates");
  });

  it("forwards include_archived=true", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeListWorkoutTemplatesTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await tool.handler({ include_archived: true });
    expect(nthCall(fetchImpl, 0)[0]).toBe(
      "http://x/api/v1/workout-templates?include_archived=true",
    );
  });
});
