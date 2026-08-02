import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeLogSleepTool } from "./log-sleep.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("log_sleep", () => {
  it("POSTs to /api/v1/sleep-logs with slept_on (wake date) and echoes both dates in summary", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 17,
          hours: 7.5,
          quality: 4,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogSleepTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({
      slept_on: "2026-05-13",
      hours: 7.5,
      quality: 4,
    });
    const r = result as { id: number; summary: string; hours: number };
    expect(r.id).toBe(17);
    expect(r.hours).toBe(7.5);
    expect(r.summary).toContain("night of");
    expect(r.summary).toContain("2026-05-12"); // night-of derived from slept_on
    expect(r.summary).toContain("2026-05-13"); // wake date
    expect(r.summary).toContain("7.5h");
    expect(r.summary).toContain("4/5");
    // The API received slept_on, not night_of.
    const body = JSON.parse(nthCall(fetchImpl, 1)[1].body);
    expect(body.slept_on).toBe("2026-05-13");
    expect(body.night_of).toBeUndefined();
  });

  it("accepts night_of and normalizes to slept_on = night_of + 1 (Gap 18)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 17,
          hours: 7.5,
          quality: 4,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogSleepTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    await tool.handler({ night_of: "2026-05-12", hours: 7.5, quality: 4 });
    // API receives slept_on derived from night_of+1; night_of itself isn't sent.
    const body = JSON.parse(nthCall(fetchImpl, 1)[1].body);
    expect(body.slept_on).toBe("2026-05-13");
    expect(body.night_of).toBeUndefined();
  });

  it("rejects passing both slept_on and night_of", () => {
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() });
    const tool = makeLogSleepTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    expect(() =>
      tool.inputSchema.parse({
        slept_on: "2026-05-13",
        night_of: "2026-05-12",
        hours: 8,
      }),
    ).toThrow(/exactly one/i);
  });

  it("rejects passing neither slept_on nor night_of", () => {
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() });
    const tool = makeLogSleepTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    expect(() => tool.inputSchema.parse({ hours: 8 })).toThrow(/exactly one/i);
  });

  it("sends an idempotency-key matching sleep:<userId>:<sha256>", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 17,
          hours: 7.5,
          quality: 4,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogSleepTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    await tool.handler({ slept_on: "2026-05-12", hours: 7.5, quality: 4 });
    const postCall = nthCall(fetchImpl, 1);
    const key = postCall[1].headers["idempotency-key"];
    expect(key).toBeDefined();
    expect(key).toMatch(/^sleep:1:[a-f0-9]{64}$/);
  });
});
