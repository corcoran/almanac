import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client.js";
import { makeCurrentUserId } from "./current-user.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("makeCurrentUserId", () => {
  it("fetches and caches the user id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockJsonResponse(200, { id: 7, name: "Jeff" }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const get = makeCurrentUserId(api, () => "alm_test");
    expect(await get()).toBe(7);
    expect(await get()).toBe(7); // second call: cached
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rethrows when the API returns an error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "unauthorized" } }),
    });
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const get = makeCurrentUserId(api, () => "alm_test");
    await expect(get()).rejects.toThrow();
  });
});
