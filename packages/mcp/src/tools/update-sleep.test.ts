import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeUpdateSleepTool } from "./update-sleep.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("update_sleep", () => {
  it("PATCHes to /api/v1/sleep-logs/:id with only the provided fields and returns the new state", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, {
        id: 4,
        hours: 7.5,
        quality: 4,
        slept_on: "2026-05-11",
        notes: null,
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateSleepTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({ id: 4, hours: 7.5 });
    const r = result as { sleep_log: { id: number; hours: number } };
    expect(r.sleep_log.id).toBe(4);
    expect(r.sleep_log.hours).toBe(7.5);
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/sleep-logs/4");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ hours: 7.5 });
    // No idempotency key on PATCH.
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 404 from the API when the id doesn't exist", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse(404, { error: { code: "not_found", message: "Sleep-log 999 not found" } }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateSleepTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ id: 999, hours: 7.5 })).rejects.toThrow(/404/);
  });
});
