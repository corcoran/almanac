import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeLogWorkoutTool } from "./log-workout.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("log_workout", () => {
  it("Shape A (full session): POSTs to /api/v1/workouts and returns id/summary", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(201, {
        id: 99,
        rpe: 7,
        template_id: null,
        exercises: [
          { exercise_id: 1, sets: [], skipped_at: null },
          { exercise_id: 2, sets: [], skipped_at: null },
          { exercise_id: 3, sets: [], skipped_at: null },
        ],
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogWorkoutTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({
      started_at: "2026-05-12T17:00:00Z",
      rpe: 7,
      exercises: [
        {
          exercise_id: 1,
          display_order: 0,
          planned_sets: 3,
          sets: [
            { reps: 5, weight_kg: 100 },
            { reps: 5, weight_kg: 100 },
            { reps: 5, weight_kg: 100 },
          ],
        },
        {
          exercise_id: 2,
          display_order: 1,
          planned_sets: 3,
          sets: { count: 3, reps: 10, weight_kg: 40 },
        },
        {
          exercise_id: 3,
          display_order: 2,
          planned_sets: 3,
          sets: { count: 3, reps: 12 },
        },
      ],
    });
    const r = result as { id: number; summary: string };
    expect(r.id).toBe(99);
    expect(r.summary).toContain("RPE 7");
    expect(r.summary).toContain("3 exercises");
    // No /api/v1/users/me call — workouts skip currentUserId since no idempotency.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does NOT send an idempotency-key header (workouts are not idempotent per spec §6.4)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(201, {
        id: 99,
        rpe: 8,
        template_id: 5,
        exercises: [{ exercise_id: 1, sets: [], skipped_at: null }],
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogWorkoutTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    await tool.handler({
      template_id: 5,
      started_at: "2026-05-12T17:00:00Z",
      rpe: 8,
      deviations: [{ op: "skip", exercise_id: 7 }],
    });
    const postCall = nthCall(fetchImpl, 0);
    const headers = postCall[1].headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBeUndefined();
  });

  it("rejects payload with neither exercises[] nor template_id", () => {
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() });
    const tool = makeLogWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    expect(() =>
      tool.inputSchema.parse({
        started_at: "2026-05-12T17:00:00Z",
        rpe: 7,
      }),
    ).toThrow(/exercises.*template_id/);
  });

  it("rejects payload with both exercises[] and deviations[]", () => {
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() });
    const tool = makeLogWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    expect(() =>
      tool.inputSchema.parse({
        template_id: 1,
        started_at: "2026-05-12T17:00:00Z",
        rpe: 7,
        exercises: [],
        deviations: [],
      }),
    ).toThrow(/not both/);
  });

  it("rejects payload with neither template_id nor exercises[]", () => {
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() });
    const tool = makeLogWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    expect(() =>
      tool.inputSchema.parse({
        started_at: "2026-05-12T17:00:00Z",
        rpe: 7,
        deviations: [{ op: "skip", exercise_id: 1 }],
      }),
    ).toThrow(/exercises.*template_id/);
  });

  it("log_workout with template_id alone is accepted (deviations defaults to [])", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(201, {
        id: 1,
        rpe: 7,
        template_id: 3,
        exercises: [{ exercise_id: 10, sets: [{ reps: 8 }], skipped_at: null }],
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeLogWorkoutTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(
      tool.handler({ template_id: 3, started_at: "2026-05-08T16:00:00Z", rpe: 7 }),
    ).resolves.toBeDefined();
    const body = JSON.parse(nthCall(fetchImpl, 0)[1].body);
    expect(body.template_id).toBe(3);
    expect(body.exercises).toBeUndefined();
    // The MCP tool forwards as-is; the API resolves the default.
  });

  it("Shape B (template + deviations): accepts and forwards deviation ops", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(201, {
        id: 100,
        rpe: 6,
        template_id: 5,
        exercises: [
          { exercise_id: 1, sets: [], skipped_at: null },
          { exercise_id: 2, sets: [], skipped_at: null },
        ],
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogWorkoutTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({
      template_id: 5,
      started_at: "2026-05-12T17:00:00Z",
      rpe: 6,
      deviations: [
        { op: "skip", exercise_id: 7 },
        {
          op: "override_sets",
          exercise_id: 8,
          sets: [{ reps: 5, weight_kg: 80 }],
        },
        {
          op: "add",
          exercise_id: 9,
          planned_sets: 3,
          sets: { count: 3, reps: 10 },
        },
      ],
    });
    const r = result as { id: number; summary: string };
    expect(r.id).toBe(100);
    expect(r.summary).toContain("RPE 6");
    expect(r.summary).toContain("2 exercises");
    // Confirm POST body includes deviations[]
    const postCall = nthCall(fetchImpl, 0);
    const body = JSON.parse(postCall[1].body);
    expect(body.deviations).toHaveLength(3);
    expect(body.deviations[0].op).toBe("skip");
  });
});
