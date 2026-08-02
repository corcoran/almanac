import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useWinsStore } from "./wins.js";

describe("useWinsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle", () => {
    const store = useWinsStore();
    expect(store.status).toBe("idle");
    expect(store.data).toBeNull();
    expect(store.error).toBeNull();
  });

  it("transitions idle -> loading -> ready on success", async () => {
    const fixture = { accomplishments: [] };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useWinsStore();
    const promise = store.load(client);
    expect(store.status).toBe("loading");
    await promise;
    expect(store.status).toBe("ready");
    expect(store.data?.accomplishments).toEqual([]);
  });

  it("transitions to error on http failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useWinsStore();
    await store.load(client);
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });
});
