import { defined, nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetSleepRecentTool } from "./get-sleep-recent.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_sleep_recent", () => {
  it("defaults to last 14 days, YYYY-MM-DD, returns sleep_logs + count", async () => {
    const logs = [
      { id: 1, slept_on: "2026-05-11", duration_min: 480 },
      { id: 2, slept_on: "2026-05-10", duration_min: 420 },
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, logs));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetSleepRecentTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const before = new Date();
    const result = await tool.handler({});

    const r = result as { sleep_logs: unknown[]; count: number };
    expect(r.sleep_logs).toEqual(logs);
    expect(r.count).toBe(2);

    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url).toContain("/api/v1/sleep-logs?");
    const fromStr = defined(new URL(url).searchParams.get("from"), "from");
    expect(fromStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const expected = new Date(before);
    expected.setUTCDate(expected.getUTCDate() - 14);
    expect(fromStr).toBe(expected.toISOString().slice(0, 10));
  });

  it("respects from_days_ago override", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetSleepRecentTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const before = new Date();
    await tool.handler({ from_days_ago: 60 });

    const url = nthCall(fetchImpl, 0)[0] as string;
    const fromStr = defined(new URL(url).searchParams.get("from"), "from");
    const expected = new Date(before);
    expected.setUTCDate(expected.getUTCDate() - 60);
    expect(fromStr).toBe(expected.toISOString().slice(0, 10));
  });

  it("forwards from_date as from, translates inclusive to_date to exclusive to (+1 day)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetSleepRecentTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await tool.handler({ from_date: "2026-05-08", to_date: "2026-05-10" });

    const params = new URL(nthCall(fetchImpl, 0)[0] as string).searchParams;
    expect(params.get("from")).toBe("2026-05-08");
    // to_date is documented inclusive; the API's `to` is exclusive, so the
    // tool sends the day after to include the final calendar date.
    expect(params.get("to")).toBe("2026-05-11");
  });

  it("selects a single night when from_date == to_date (inclusive bound)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetSleepRecentTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await tool.handler({ from_date: "2026-06-03", to_date: "2026-06-03" });

    const params = new URL(nthCall(fetchImpl, 0)[0] as string).searchParams;
    expect(params.get("from")).toBe("2026-06-03");
    // Inclusive single-night select: from=2026-06-03, to=2026-06-04 (exclusive)
    // so the June-3 record is returned instead of an empty range.
    expect(params.get("to")).toBe("2026-06-04");
  });

  it("translates month-end to_date correctly (rolls into next month)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetSleepRecentTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await tool.handler({ from_date: "2026-05-31", to_date: "2026-05-31" });

    const params = new URL(nthCall(fetchImpl, 0)[0] as string).searchParams;
    expect(params.get("to")).toBe("2026-06-01");
  });
});
