import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetTdeeTool } from "./get-tdee.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_tdee", () => {
  it("GETs /api/v1/signals/tdee with no params by default", async () => {
    const body = {
      kcal: 2750,
      basis: "measured_intake",
      confidence: "established",
      // `source` is the TDEE-refactor provenance hint — `formula` aligns with
      // `basis: profile_baseline`, `measured` aligns with `basis:
      // measured_intake`. The MCP tool is a passthrough; we just assert the
      // field survives the round-trip.
      source: "measured",
      window_days: 21,
      days_of_data: 60,
      components: { avg_kcal_in: 2700, trend_weight_change_kg: -0.1 },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, body));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetTdeeTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({});
    expect(result).toEqual(body);
    const url = nthCall(fetchImpl, 0)[0] as string;
    // No query string when no window_days is given.
    expect(url).toBe("http://x/api/v1/signals/tdee");
  });

  it("passes window_days as a query param when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, {}));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetTdeeTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await tool.handler({ window_days: 28 });

    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(new URL(url).searchParams.get("window_days")).toBe("28");
  });
});
