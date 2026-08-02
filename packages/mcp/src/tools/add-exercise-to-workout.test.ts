import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeAddExerciseToWorkoutTool } from "./add-exercise-to-workout.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("add_exercise_to_workout", () => {
  it("POSTs to /api/v1/workouts/:id/exercise-instances with the body sans workout_id and returns the new instance", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(201, {
        id: 42,
        exercise_id: 11,
        display_order: 3,
        planned_sets: 3,
        notes: null,
        sets: [{ id: 100, reps: 10, weight_kg: 60, notes: null }],
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAddExerciseToWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({
      workout_id: 7,
      exercise_id: 11,
      display_order: 3,
      planned_sets: 3,
      sets: [{ reps: 10, weight_kg: 60 }],
    });
    const r = result as {
      workout_id: number;
      exercise_instance: { id: number; exercise_id: number };
    };
    expect(r.workout_id).toBe(7);
    expect(r.exercise_instance.id).toBe(42);
    expect(r.exercise_instance.exercise_id).toBe(11);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/workouts/7/exercise-instances");
    expect(call[1].method).toBe("POST");
    // No idempotency key on this POST.
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 404 from the API when the workout_id doesn't exist", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(404, { error: { code: "not_found", message: "Workout 999 not found" } }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAddExerciseToWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(
      tool.handler({
        workout_id: 999,
        exercise_id: 11,
        display_order: 3,
        planned_sets: 3,
        sets: [{ reps: 10, weight_kg: 60 }],
      }),
    ).rejects.toThrow(/404/);
  });

  it("strips workout_id from the POST body", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(201, {
        id: 42,
        exercise_id: 11,
        display_order: 3,
        planned_sets: 3,
        notes: null,
        sets: [{ id: 100, reps: 10, weight_kg: 60, notes: null }],
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAddExerciseToWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await tool.handler({
      workout_id: 7,
      exercise_id: 11,
      display_order: 3,
      planned_sets: 3,
      sets: [{ reps: 10, weight_kg: 60 }],
    });
    const call = nthCall(fetchImpl, 0);
    const body = JSON.parse(call[1].body) as Record<string, unknown>;
    expect(body).toEqual({
      exercise_id: 11,
      display_order: 3,
      planned_sets: 3,
      sets: [{ reps: 10, weight_kg: 60 }],
    });
  });

  it("includes explicit notes in the POST body when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(201, {
        id: 42,
        exercise_id: 11,
        display_order: 3,
        planned_sets: 3,
        notes: "something specific",
        sets: [{ id: 100, reps: 10, weight_kg: 60, notes: null }],
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAddExerciseToWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await tool.handler({
      workout_id: 7,
      exercise_id: 11,
      display_order: 3,
      planned_sets: 3,
      sets: [{ reps: 10, weight_kg: 60 }],
      notes: "something specific",
    });
    const call = nthCall(fetchImpl, 0);
    const body = JSON.parse(call[1].body) as Record<string, unknown>;
    expect(body).toEqual({
      exercise_id: 11,
      display_order: 3,
      planned_sets: 3,
      sets: [{ reps: 10, weight_kg: 60 }],
      notes: "something specific",
    });
  });
});
