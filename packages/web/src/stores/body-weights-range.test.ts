import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useBodyWeightsRangeStore } from "./body-weights-range.js";

describe("useBodyWeightsRangeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle", () => {
    const store = useBodyWeightsRangeStore();
    expect(store.status).toBe("idle");
    expect(store.data).toEqual([]);
    expect(store.error).toBeNull();
  });

  it("loads sparse body-weight entries into data when GET succeeds", async () => {
    const fixture = makeBodyWeightsFixture();
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toContain("/v1/body-weights");
      expect(url).toContain("from=2026-05-08");
      expect(url).toContain("to=2026-05-21");
      return Promise.resolve(
        new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useBodyWeightsRangeStore();
    const promise = store.load(client, "2026-05-08", "2026-05-21");
    expect(store.status).toBe("loading");
    await promise;
    expect(store.status).toBe("ready");
    expect(store.data).toHaveLength(fixture.length);
    expect(store.data[0]?.measured_on).toBe("2026-05-08");
    expect(store.data[0]?.weight_kg).toBe(82.4);
  });

  it("transitions to error on HTTP 500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useBodyWeightsRangeStore();
    await store.load(client, "2026-05-08", "2026-05-21");
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });

  it("sorts data ascending by measured_on even if API returns DESC", async () => {
    // Mirror the real repo: ORDER BY measured_on DESC (newest first).
    const fixture = [...makeBodyWeightsFixture()].reverse();
    expect(fixture[0]?.measured_on).toBe("2026-05-21"); // sanity: starts DESC
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useBodyWeightsRangeStore();
    await store.load(client, "2026-05-08", "2026-05-22");
    // Chart components render left-to-right, so the store hands them
    // entries in chronological order: oldest first, today last.
    expect(store.data.map((w) => w.measured_on)).toEqual([
      "2026-05-08",
      "2026-05-10",
      "2026-05-12",
      "2026-05-15",
      "2026-05-18",
      "2026-05-21",
    ]);
  });

  it("reload(client, from, to) re-fetches with a fresh response", async () => {
    const first = makeBodyWeightsFixture();
    const second = makeBodyWeightsFixture({ weight_kg: 81.0 });
    let call = 0;
    const fetchImpl = vi.fn(() => {
      const body = call++ === 0 ? first : second;
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useBodyWeightsRangeStore();
    await store.load(client, "2026-05-08", "2026-05-21");
    expect(store.data[0]?.weight_kg).toBe(82.4);
    await store.reload(client, "2026-05-08", "2026-05-21");
    expect(store.status).toBe("ready");
    expect(store.data[0]?.weight_kg).toBe(81.0);
  });
});

function makeBodyWeightsFixture(opts: { weight_kg?: number } = {}) {
  // Sparse weights — user doesn't weigh every day. 6 entries across a 14-day
  // window is realistic.
  const first = opts.weight_kg ?? 82.4;
  return [
    {
      id: 1,
      user_id: 1,
      measured_on: "2026-05-08",
      weight_kg: first,
      notes: null,
      created_at: "2026-05-08T07:30:00Z",
    },
    {
      id: 2,
      user_id: 1,
      measured_on: "2026-05-10",
      weight_kg: 82.1,
      notes: null,
      created_at: "2026-05-10T07:30:00Z",
    },
    {
      id: 3,
      user_id: 1,
      measured_on: "2026-05-12",
      weight_kg: 82.5,
      notes: "post-cheat-day",
      created_at: "2026-05-12T07:30:00Z",
    },
    {
      id: 4,
      user_id: 1,
      measured_on: "2026-05-15",
      weight_kg: 81.8,
      notes: null,
      created_at: "2026-05-15T07:30:00Z",
    },
    {
      id: 5,
      user_id: 1,
      measured_on: "2026-05-18",
      weight_kg: 81.5,
      notes: null,
      created_at: "2026-05-18T07:30:00Z",
    },
    {
      id: 6,
      user_id: 1,
      measured_on: "2026-05-21",
      weight_kg: 81.2,
      notes: null,
      created_at: "2026-05-21T07:30:00Z",
    },
  ];
}
