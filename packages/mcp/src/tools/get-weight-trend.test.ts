import { defined, nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetWeightTrendTool } from "./get-weight-trend.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_weight_trend", () => {
  it("defaults to last 30 days, sends YYYY-MM-DD, returns { points }", async () => {
    const points = [
      { measured_on: "2026-05-01", weight_kg: 80.1, trend_kg: 80.5 },
      { measured_on: "2026-05-02", weight_kg: 79.8, trend_kg: 80.4 },
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, points));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetWeightTrendTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const before = new Date();
    const result = await tool.handler({});

    const r = result as { points: unknown[] };
    expect(r.points).toEqual(points);

    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url).toContain("/api/v1/signals/trend-weight?");
    const fromStr = defined(new URL(url).searchParams.get("from"), "from");
    expect(fromStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const _fromDate = new Date(`${fromStr}T00:00:00Z`);
    const expectedFrom = new Date(before);
    expectedFrom.setUTCDate(expectedFrom.getUTCDate() - 30);
    const expectedStr = expectedFrom.toISOString().slice(0, 10);
    expect(fromStr).toBe(expectedStr);
  });

  it("respects from_days_ago override", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetWeightTrendTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const before = new Date();
    await tool.handler({ from_days_ago: 90 });

    const url = nthCall(fetchImpl, 0)[0] as string;
    const fromStr = defined(new URL(url).searchParams.get("from"), "from");
    const expected = new Date(before);
    expected.setUTCDate(expected.getUTCDate() - 90);
    expect(fromStr).toBe(expected.toISOString().slice(0, 10));
  });

  it("respects explicit from/to", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetWeightTrendTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await tool.handler({ from: "2026-01-01", to: "2026-02-01" });

    const params = new URL(nthCall(fetchImpl, 0)[0] as string).searchParams;
    expect(params.get("from")).toBe("2026-01-01");
    expect(params.get("to")).toBe("2026-02-01");
  });
});
