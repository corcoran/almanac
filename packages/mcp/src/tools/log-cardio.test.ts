import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeLogCardioTool } from "./log-cardio.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("log_cardio", () => {
  it("POSTs to /api/v1/cardio-sessions and returns id/summary/est_kcal", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 9,
          modality: "bike",
          duration_min: 45,
          est_kcal: 420,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogCardioTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({
      started_at: "2026-05-12T17:00:00Z",
      duration_min: 45,
      modality: "bike",
      avg_hr: 145,
      est_kcal: 420,
    });
    const r = result as { id: number; summary: string; est_kcal: number };
    expect(r.id).toBe(9);
    expect(r.est_kcal).toBe(420);
    expect(r.summary).toContain("bike");
    expect(r.summary).toContain("420 kcal");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("forwards steps when provided (Gap 17)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 9,
          modality: "walk",
          duration_min: 45,
          est_kcal: 200,
          steps: 7500,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogCardioTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    await tool.handler({
      started_at: "2026-05-13T17:00:00Z",
      modality: "walk",
      duration_min: 45,
      est_kcal: 200,
      steps: 7500,
    });
    const postCall = nthCall(fetchImpl, 1);
    const sentBody = JSON.parse(postCall[1].body);
    expect(sentBody.steps).toBe(7500);
  });

  it("sends an idempotency-key matching cardio:<userId>:<sha256>", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 9,
          modality: "bike",
          duration_min: 45,
          est_kcal: 420,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogCardioTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    await tool.handler({
      started_at: "2026-05-12T17:00:00Z",
      duration_min: 45,
      modality: "bike",
      est_kcal: 420,
    });
    const postCall = nthCall(fetchImpl, 1);
    const key = postCall[1].headers["idempotency-key"];
    expect(key).toBeDefined();
    expect(key).toMatch(/^cardio:1:[a-f0-9]{64}$/);
  });
});
