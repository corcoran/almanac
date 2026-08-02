import { defined, nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetCardioRecentTool } from "./get-cardio-recent.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_cardio_recent", () => {
  it("defaults to last 14 days and returns cardio_sessions + count", async () => {
    const sessions = [
      { id: 1, started_at: "2026-05-09T06:30:00Z", duration_min: 30, modality: "zone2" },
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, sessions));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetCardioRecentTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const before = Date.now();
    const result = await tool.handler({});

    const r = result as { cardio_sessions: unknown[]; count: number };
    expect(r.cardio_sessions).toEqual(sessions);
    expect(r.count).toBe(1);

    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url).toContain("/api/v1/cardio-sessions?");
    const fromMs = new Date(defined(new URL(url).searchParams.get("from"), "from")).getTime();
    expect(Math.abs(fromMs - (before - 14 * 24 * 60 * 60 * 1000))).toBeLessThan(2000);
  });

  it("respects from_days_ago override", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetCardioRecentTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const before = Date.now();
    await tool.handler({ from_days_ago: 7 });

    const url = nthCall(fetchImpl, 0)[0] as string;
    const fromMs = new Date(defined(new URL(url).searchParams.get("from"), "from")).getTime();
    expect(Math.abs(fromMs - (before - 7 * 24 * 60 * 60 * 1000))).toBeLessThan(2000);
  });

  it("forwards from_date/to_date to the querystring", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetCardioRecentTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await tool.handler({ from_date: "2026-05-08", to_date: "2026-05-08" });

    const params = new URL(nthCall(fetchImpl, 0)[0] as string).searchParams;
    expect(params.get("from_date")).toBe("2026-05-08");
    expect(params.get("to_date")).toBe("2026-05-08");
    expect(params.get("from")).toBeNull();
  });
});
