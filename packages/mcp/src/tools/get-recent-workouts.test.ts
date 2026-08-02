import { defined, nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetRecentWorkoutsTool } from "./get-recent-workouts.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_recent_workouts", () => {
  it("defaults to last 7 days and returns workouts + count", async () => {
    const workouts = [
      { id: 1, started_at: "2026-05-10T17:00:00Z", title: "Push" },
      { id: 2, started_at: "2026-05-08T17:00:00Z", title: "Pull" },
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, workouts));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetRecentWorkoutsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const before = Date.now();
    const result = await tool.handler({});
    const after = Date.now();

    const r = result as { workouts: unknown[]; count: number };
    expect(r.workouts).toEqual(workouts);
    expect(r.count).toBe(2);

    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url).toContain("/api/v1/workouts?");
    const fromStr = defined(new URL(url).searchParams.get("from"), "from");
    const fromMs = new Date(fromStr).getTime();
    const expectedFromMs = before - 7 * 24 * 60 * 60 * 1000;
    // Allow a 2-second window to account for execution time.
    expect(fromMs).toBeGreaterThanOrEqual(expectedFromMs - 2000);
    expect(fromMs).toBeLessThanOrEqual(after - 7 * 24 * 60 * 60 * 1000 + 2000);
  });

  it("respects from_days_ago override", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetRecentWorkoutsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const before = Date.now();
    await tool.handler({ from_days_ago: 30 });

    const url = nthCall(fetchImpl, 0)[0] as string;
    const fromStr = defined(new URL(url).searchParams.get("from"), "from");
    const fromMs = new Date(fromStr).getTime();
    const expectedFromMs = before - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(fromMs - expectedFromMs)).toBeLessThan(2000);
  });

  it("respects explicit from override", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetRecentWorkoutsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await tool.handler({ from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" });

    const url = nthCall(fetchImpl, 0)[0] as string;
    const params = new URL(url).searchParams;
    expect(params.get("from")).toBe("2026-01-01T00:00:00.000Z");
    expect(params.get("to")).toBe("2026-02-01T00:00:00.000Z");
  });
});
