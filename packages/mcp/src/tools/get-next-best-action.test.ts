import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetNextBestActionTool } from "./get-next-best-action.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_next_best_action", () => {
  it("GETs the next-best-action signal and returns it", async () => {
    const payload = {
      as_of: "2026-06-03",
      onboarding_complete: true,
      headline: null,
      actions: [],
      all_clear: true,
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, payload));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetNextBestActionTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    expect(tool.name).toBe("get_next_best_action");

    const result = await tool.handler({});
    expect(result).toEqual(payload);
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/signals/next-best-action");
  });
});
