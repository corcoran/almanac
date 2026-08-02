import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeTemplatesResource } from "./templates.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("almanac://templates resource", () => {
  it("GETs /api/v1/workout-templates and serializes to JSON", async () => {
    const templates = [
      { id: 1, name: "Push day", items: [{ exercise_id: 7, default_sets: 3 }] },
      { id: 2, name: "Pull day", items: [] },
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, templates));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const resource = makeTemplatesResource({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    expect(resource.uri).toBe("almanac://templates");
    expect(resource.mimeType).toBe("application/json");

    const body = await resource.handler();
    expect(JSON.parse(body)).toEqual(templates);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/workout-templates");
  });
});
