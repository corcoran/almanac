import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeDefineExerciseTool } from "./define-exercise.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("define_exercise", () => {
  it("POSTs to /api/v1/exercises with the input body and returns the created exercise", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(201, {
        id: 11,
        group_id: 1,
        name: "Bench press",
        notes: null,
        archived_at: null,
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeDefineExerciseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({ group_id: 1, name: "Bench press" });
    const r = result as { exercise: { id: number; name: string } };
    expect(r.exercise.id).toBe(11);
    expect(r.exercise.name).toBe("Bench press");
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/exercises");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({ group_id: 1, name: "Bench press" });
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 422 from the API when the group_id is invalid", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(422, {
        error: { code: "validation_failed", message: "Invalid group_id" },
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeDefineExerciseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ group_id: 999, name: "Bench press" })).rejects.toThrow(/422/);
  });
});
