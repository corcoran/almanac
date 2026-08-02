import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeLogWeightTool } from "./log-weight.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("log_weight", () => {
  it("POSTs to /api/v1/body-weights and returns id/summary/measured_on", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 42,
          weight_kg: 82.3,
          measured_on: "2026-05-12",
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogWeightTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({
      measured_on: "2026-05-12",
      weight_kg: 82.3,
    });
    const r = result as { id: number; summary: string; weight_kg: number; measured_on: string };
    expect(r.id).toBe(42);
    expect(r.weight_kg).toBe(82.3);
    expect(r.measured_on).toBe("2026-05-12");
    expect(r.summary).toContain("82.3 kg");
    expect(r.summary).toContain("2026-05-12");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends an idempotency-key matching body-weight:<userId>:<sha256>", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 42,
          weight_kg: 82.3,
          measured_on: "2026-05-12",
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogWeightTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    await tool.handler({ measured_on: "2026-05-12", weight_kg: 82.3 });
    const postCall = nthCall(fetchImpl, 1);
    const key = postCall[1].headers["idempotency-key"];
    expect(key).toBeDefined();
    expect(key).toMatch(/^body-weight:1:[a-f0-9]{64}$/);
  });
});
