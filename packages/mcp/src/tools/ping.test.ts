import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makePingTool } from "./ping.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("ping", () => {
  it("GETs /api/v1/health and returns the response verbatim", async () => {
    const body = { ok: true, migrations_applied: 8, version: "0.0.0" };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, body));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makePingTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({});

    expect(result).toEqual(body);
    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url).toBe("http://x/api/v1/health");
  });
});
