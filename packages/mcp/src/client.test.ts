import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client.js";

describe("ApiClient", () => {
  it("ApiClient.request stamps the per-call bearer, not a construction-time secret", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    // No secret/emailHeader at construction.
    await api.request("GET", "/foo", undefined, { bearer: "alm_xyz" });
    const init = nthCall(fetchImpl, 0)[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer alm_xyz");
  });

  it("ApiClient.request throws when no bearer is supplied", () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    // Calling request without a bearer is a programmer error.
    expect(() => api.request("GET", "/foo", undefined, { bearer: "" })).toThrow();
  });
});
