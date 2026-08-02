import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeDefineWorkoutTemplateTool } from "./define-workout-template.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("define_workout_template", () => {
  it("POSTs to /api/v1/workout-templates with the input body and returns the created template", async () => {
    const created = {
      id: 3,
      user_id: 1,
      name: "Push A",
      notes: null,
      archived_at: null,
      created_at: "2026-05-12T08:00:00Z",
      items: [
        {
          id: 10,
          template_id: 3,
          exercise_id: 11,
          display_order: 0,
          default_sets: 3,
          default_reps: 8,
          default_weight_kg: 80,
          notes: null,
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(201, created));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeDefineWorkoutTemplateTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const body = {
      name: "Push A",
      items: [
        {
          exercise_id: 11,
          display_order: 0,
          default_sets: 3,
          default_reps: 8,
          default_weight_kg: 80,
        },
      ],
    };
    const result = await tool.handler(body);
    const r = result as { workout_template: { id: number; name: string; items: unknown[] } };
    expect(r.workout_template.id).toBe(3);
    expect(r.workout_template.name).toBe("Push A");
    expect(r.workout_template.items).toHaveLength(1);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/workout-templates");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual(body);
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 422 from the API when items are invalid", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(422, {
        error: { code: "validation_failed", message: "exercise_id must be positive" },
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeDefineWorkoutTemplateTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(
      tool.handler({
        name: "Push A",
        items: [{ exercise_id: 0, display_order: 0, default_sets: 3 }],
      }),
    ).rejects.toThrow(/422/);
  });
});
