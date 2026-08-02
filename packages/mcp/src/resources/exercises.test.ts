import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeExercisesResource } from "./exercises.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("almanac://exercises resource", () => {
  it("GETs /api/v1/exercises and serializes to JSON", async () => {
    const exercises = [
      { id: 1, name: "Bench press", group_id: 1, group_name: "chest" },
      { id: 2, name: "Barbell row", group_id: 2, group_name: "back" },
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, exercises));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const resource = makeExercisesResource({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    expect(resource.uri).toBe("almanac://exercises");
    expect(resource.mimeType).toBe("application/json");

    const body = await resource.handler();
    expect(JSON.parse(body)).toEqual(exercises);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/exercises");
  });
});
