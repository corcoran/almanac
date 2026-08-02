import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useNextBestActionStore } from "./nextBestAction.js";

describe("useNextBestActionStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle", () => {
    const store = useNextBestActionStore();
    expect(store.status).toBe("idle");
    expect(store.data).toBeNull();
    expect(store.error).toBeNull();
  });

  it("transitions idle -> loading -> ready on success", async () => {
    const fixture = makeAllClearFixture();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useNextBestActionStore();
    const promise = store.load(client);
    expect(store.status).toBe("loading");
    await promise;
    expect(store.status).toBe("ready");
    expect(store.data?.all_clear).toBe(true);
    expect(store.data?.headline).toBeNull();
  });

  it("transitions to error on http failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useNextBestActionStore();
    await store.load(client);
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });
});

/**
 * Minimal valid NextBestActionResponseSchema — the all-clear case (no
 * actionable nudges). Constructed from the schema, not captured from a live
 * API response.
 */
function makeAllClearFixture() {
  return {
    as_of: "2026-06-05",
    onboarding_complete: true,
    headline: null,
    actions: [],
    all_clear: true,
  };
}
