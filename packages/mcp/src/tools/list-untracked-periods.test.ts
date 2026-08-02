import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeListUntrackedPeriodsTool } from "./list-untracked-periods.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}
const deps = (fetchImpl: typeof fetch) => ({
  api: new ApiClient({ baseUrl: "http://x", fetchImpl }),
  currentUserId: async () => 1,
  currentToken: () => "alm_test",
});

describe("list_untracked_periods", () => {
  it("GETs /api/v1/untracked-periods and returns {periods, count}", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, [{ id: 1 }, { id: 2 }]));
    const tool = makeListUntrackedPeriodsTool(deps(fetchImpl));
    const result = await tool.handler({});
    expect(result).toEqual({ periods: [{ id: 1 }, { id: 2 }], count: 2 });
    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url.startsWith("http://x/api/v1/untracked-periods")).toBe(true);
  });

  it("passes from_date/to_date as query params when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const tool = makeListUntrackedPeriodsTool(deps(fetchImpl));
    await tool.handler({ from_date: "2026-05-01", to_date: "2026-05-31" });
    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url).toContain("from_date=2026-05-01");
    expect(url).toContain("to_date=2026-05-31");
  });

  it("is read-only", () => {
    const tool = makeListUntrackedPeriodsTool(deps(vi.fn()));
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
});
