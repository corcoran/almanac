import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeListExercisesTool } from "./list-exercises.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("list_exercises", () => {
  it("GETs /api/v1/exercises and returns the array", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(200, [{ id: 10, name: "Incline DB Press", group_id: 1 }]),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeListExercisesTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({})) as { exercises: Array<{ id: number; name: string }> };
    expect(result.exercises[0]?.name).toBe("Incline DB Press");
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/exercises");
  });

  it("forwards group_id as a querystring", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeListExercisesTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await tool.handler({ group_id: 1 });
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/exercises?group_id=1");
  });

  it("forwards include_archived=true", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeListExercisesTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await tool.handler({ include_archived: true });
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/exercises?include_archived=true");
  });
});
