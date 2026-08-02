import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeLogStepsTool } from "./log-steps.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("log_steps", () => {
  it("POSTs to /api/v1/step-logs and returns id + summary with formatted step count and kcal", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 42,
          on_date: "2026-05-13",
          steps: 8421,
          est_kcal: 320,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogStepsTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({
      on_date: "2026-05-13",
      steps: 8421,
    });
    const r = result as { id: number; summary: string };
    expect(r.id).toBe(42);
    expect(r.summary).toContain("8,421");
    expect(r.summary).toContain("2026-05-13");
    expect(r.summary).toContain("320 kcal");
    // Verify the URL + body shape.
    const postCall = nthCall(fetchImpl, 1);
    expect(postCall[0]).toBe("http://x/api/v1/step-logs");
    const body = JSON.parse(postCall[1].body);
    expect(body).toEqual({ on_date: "2026-05-13", steps: 8421 });
  });

  it("honors est_kcal override when supplied", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 7,
          on_date: "2026-05-13",
          steps: 10000,
          est_kcal: 555,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogStepsTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    await tool.handler({ on_date: "2026-05-13", steps: 10000, est_kcal: 555 });
    const body = JSON.parse(nthCall(fetchImpl, 1)[1].body);
    expect(body.est_kcal).toBe(555);
  });

  it("sends an idempotency-key matching steps:<userId>:<sha256>", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 1,
          on_date: "2026-05-13",
          steps: 5000,
          est_kcal: 200,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogStepsTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    await tool.handler({ on_date: "2026-05-13", steps: 5000 });
    const postCall = nthCall(fetchImpl, 1);
    const key = postCall[1].headers["idempotency-key"];
    expect(key).toBeDefined();
    expect(key).toMatch(/^steps:1:[a-f0-9]{64}$/);
  });
});
