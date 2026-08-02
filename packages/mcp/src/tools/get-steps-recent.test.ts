import { defined, nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetStepsRecentTool } from "./get-steps-recent.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_steps_recent", () => {
  it("defaults to last 14 days, YYYY-MM-DD, returns step_logs + count", async () => {
    const logs = [
      { id: 1, on_date: "2026-05-11", steps: 8421, est_kcal: 320 },
      { id: 2, on_date: "2026-05-10", steps: 5000, est_kcal: 200 },
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, logs));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetStepsRecentTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const before = new Date();
    const result = await tool.handler({});

    const r = result as { step_logs: unknown[]; count: number };
    expect(r.step_logs).toEqual(logs);
    expect(r.count).toBe(2);

    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url).toContain("/api/v1/step-logs?");
    const fromStr = defined(new URL(url).searchParams.get("from"), "from");
    expect(fromStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const expected = new Date(before);
    expected.setUTCDate(expected.getUTCDate() - 14);
    expect(fromStr).toBe(expected.toISOString().slice(0, 10));
  });

  it("respects from_days_ago override", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetStepsRecentTool({
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

  it("forwards from_date/to_date as from/to (steps is date-keyed)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetStepsRecentTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await tool.handler({ from_date: "2026-05-08", to_date: "2026-05-08" });

    const params = new URL(nthCall(fetchImpl, 0)[0] as string).searchParams;
    expect(params.get("from")).toBe("2026-05-08");
    expect(params.get("to")).toBe("2026-05-08");
  });
});
