import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeCreateUntrackedPeriodTool } from "./create-untracked-period.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

const deps = (fetchImpl: typeof fetch) => ({
  api: new ApiClient({ baseUrl: "http://x", fetchImpl }),
  currentUserId: async () => 1,
  currentToken: () => "alm_test",
});

describe("create_untracked_period", () => {
  it("POSTs /api/v1/untracked-periods and returns the period", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(201, { id: 1, reason: "vacation", started_on: "2026-05-01" }),
      );
    const tool = makeCreateUntrackedPeriodTool(deps(fetchImpl));
    const result = await tool.handler({
      started_on: "2026-05-01",
      ended_on: "2026-05-07",
      reason: "vacation",
    });
    expect(result).toEqual({ period: { id: 1, reason: "vacation", started_on: "2026-05-01" } });
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/untracked-periods");
    expect((nthCall(fetchImpl, 0)[1] as RequestInit).method).toBe("POST");
  });

  it("forwards a 422 overlap envelope as a tool error", async () => {
    const envelope = { error: "period_overlap", message: "overlaps", conflicting_period: {} };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(422, envelope));
    const tool = makeCreateUntrackedPeriodTool(deps(fetchImpl));
    await expect(
      tool.handler({ started_on: "2026-05-05", ended_on: "2026-05-10", reason: "deload" }),
    ).rejects.toMatchObject({ payload: envelope });
  });

  it("propagates a non-4xx error untouched (no ToolError wrapping)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(500, { error: "internal" }));
    const tool = makeCreateUntrackedPeriodTool(deps(fetchImpl));
    await expect(
      tool.handler({ started_on: "2026-05-01", ended_on: "2026-05-07", reason: "vacation" }),
    ).rejects.not.toHaveProperty("payload");
  });

  it("is not a read-only tool", () => {
    const tool = makeCreateUntrackedPeriodTool(deps(vi.fn()));
    expect(tool.annotations?.readOnlyHint).toBe(false);
  });
});
