import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeLogAlcoholTool } from "./log-alcohol.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("log_alcohol", () => {
  it("POSTs to /api/v1/alcohol-sessions and returns id/summary/est_kcal", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 23,
          drinks_count: 5,
          est_kcal: 700,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogAlcoholTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({
      started_at: "2026-05-12T20:00:00Z",
      ended_at: "2026-05-13T02:00:00Z",
      drinks_count: 5,
      est_kcal: 700,
      notes: "2 beer, 3 gin & soda",
    });
    const r = result as { id: number; summary: string; est_kcal: number };
    expect(r.id).toBe(23);
    expect(r.est_kcal).toBe(700);
    expect(r.summary).toContain("5 std");
    expect(r.summary).toContain("700 kcal");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends an idempotency-key matching alcohol:<userId>:<sha256>", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 23,
          drinks_count: 5,
          est_kcal: 700,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogAlcoholTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    await tool.handler({
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 5,
      est_kcal: 700,
    });
    const postCall = nthCall(fetchImpl, 1);
    const key = postCall[1].headers["idempotency-key"];
    expect(key).toBeDefined();
    expect(key).toMatch(/^alcohol:1:[a-f0-9]{64}$/);
  });
});
