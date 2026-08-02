import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeStimStatesResource } from "./stim-states.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("almanac://stim-states resource", () => {
  it("GETs /api/v1/signals/stim-states and serializes to JSON", async () => {
    const stimStates = [
      { group_id: 1, group_name: "chest", state: "fresh", last_stim_at: null },
      { group_id: 2, group_name: "back", state: "fading", last_stim_at: "2026-05-10T18:00:00Z" },
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, stimStates));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const resource = makeStimStatesResource({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    expect(resource.uri).toBe("almanac://stim-states");
    expect(resource.mimeType).toBe("application/json");

    const body = await resource.handler();
    expect(JSON.parse(body)).toEqual(stimStates);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/signals/stim-states");
  });
});
