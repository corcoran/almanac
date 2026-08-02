import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeDeleteUntrackedPeriodTool } from "./delete-untracked-period.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}
const deps = (fetchImpl: typeof fetch) => ({
  api: new ApiClient({ baseUrl: "http://x", fetchImpl }),
  currentUserId: async () => 1,
  currentToken: () => "alm_test",
});

describe("delete_untracked_period", () => {
  it("DELETEs /api/v1/untracked-periods/:id and returns {deleted, period_id}", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(204, ""));
    const tool = makeDeleteUntrackedPeriodTool(deps(fetchImpl));
    const result = await tool.handler({ period_id: 7, confirm: true });
    expect(result).toEqual({ deleted: true, period_id: 7 });
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/untracked-periods/7");
    expect((nthCall(fetchImpl, 0)[1] as RequestInit).method).toBe("DELETE");
  });

  it("rejects calls without confirm: true at the schema level", () => {
    const tool = makeDeleteUntrackedPeriodTool(deps(vi.fn()));
    expect(tool.inputSchema.safeParse({ period_id: 7 }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ period_id: 7, confirm: false }).success).toBe(false);
  });

  it("advertises destructiveHint: true", () => {
    const tool = makeDeleteUntrackedPeriodTool(deps(vi.fn()));
    expect(tool.annotations?.destructiveHint).toBe(true);
  });
});
