import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeUpdateWorkoutTemplateTool } from "./update-workout-template.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("update_workout_template", () => {
  it("PATCHes /api/v1/workout-templates/:id when only meta (name/notes) is provided", async () => {
    const updated = {
      id: 3,
      user_id: 1,
      name: "Push A (revised)",
      notes: "tweak",
      archived_at: null,
      created_at: "2026-05-12T08:00:00Z",
      items: [],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, updated));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateWorkoutTemplateTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({ id: 3, name: "Push A (revised)", notes: "tweak" });
    const r = result as { workout_template: { id: number; name: string } };
    expect(r.workout_template.id).toBe(3);
    expect(r.workout_template.name).toBe("Push A (revised)");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/workout-templates/3");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ name: "Push A (revised)", notes: "tweak" });
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("PUTs /api/v1/workout-templates/:id/items when only items is provided", async () => {
    const refreshed = {
      id: 3,
      user_id: 1,
      name: "Push A",
      notes: null,
      archived_at: null,
      created_at: "2026-05-12T08:00:00Z",
      items: [
        {
          id: 21,
          template_id: 3,
          exercise_id: 11,
          display_order: 0,
          default_sets: 4,
          default_reps: 6,
          default_weight_kg: 85,
          notes: null,
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, refreshed));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateWorkoutTemplateTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const items = [
      {
        exercise_id: 11,
        display_order: 0,
        default_sets: 4,
        default_reps: 6,
        default_weight_kg: 85,
      },
    ];
    const result = await tool.handler({ id: 3, items });
    const r = result as { workout_template: { id: number; items: unknown[] } };
    expect(r.workout_template.id).toBe(3);
    expect(r.workout_template.items).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/workout-templates/3/items");
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body)).toEqual({ items });
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("hits BOTH endpoints in order (PATCH first, then PUT) when meta + items are both provided", async () => {
    const afterPatch = {
      id: 3,
      user_id: 1,
      name: "Push A v2",
      notes: null,
      archived_at: null,
      created_at: "2026-05-12T08:00:00Z",
      items: [],
    };
    const afterPut = {
      ...afterPatch,
      items: [
        {
          id: 22,
          template_id: 3,
          exercise_id: 11,
          display_order: 0,
          default_sets: 5,
          default_reps: 5,
          default_weight_kg: 90,
          notes: null,
        },
      ],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, afterPatch))
      .mockResolvedValueOnce(mockJsonResponse(200, afterPut));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateWorkoutTemplateTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const items = [
      {
        exercise_id: 11,
        display_order: 0,
        default_sets: 5,
        default_reps: 5,
        default_weight_kg: 90,
      },
    ];
    const result = await tool.handler({ id: 3, name: "Push A v2", items });
    const r = result as { workout_template: { items: unknown[] } };
    // PUT response wins.
    expect(r.workout_template.items).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // First call: PATCH meta.
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/workout-templates/3");
    expect(nthCall(fetchImpl, 0)[1].method).toBe("PATCH");
    expect(JSON.parse(nthCall(fetchImpl, 0)[1].body)).toEqual({ name: "Push A v2" });
    // Second call: PUT items.
    expect(nthCall(fetchImpl, 1)[0]).toBe("http://x/api/v1/workout-templates/3/items");
    expect(nthCall(fetchImpl, 1)[1].method).toBe("PUT");
    expect(JSON.parse(nthCall(fetchImpl, 1)[1].body)).toEqual({ items });
    expect(nthCall(fetchImpl, 0)[1].headers["idempotency-key"]).toBeUndefined();
    expect(nthCall(fetchImpl, 1)[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("throws when called with only an id and no patch fields", async () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateWorkoutTemplateTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ id: 3 })).rejects.toThrow(/nothing to do|name, notes, items/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
