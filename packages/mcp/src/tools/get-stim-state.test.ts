import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetStimStateTool } from "./get-stim-state.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_stim_state", () => {
  it("GETs /api/v1/signals/stim-states and returns the stim_states object", async () => {
    const body = {
      stim_states: [{ compound: "caffeine", state: "active", started_at: "2026-05-12T07:00:00Z" }],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, body));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetStimStateTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({});
    expect(result).toEqual(body);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/signals/stim-states");
    expect(nthCall(fetchImpl, 0)[1].method).toBe("GET");
  });
});
