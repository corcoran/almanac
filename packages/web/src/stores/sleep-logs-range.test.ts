import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useSleepLogsRangeStore } from "./sleep-logs-range.js";

describe("useSleepLogsRangeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle", () => {
    const store = useSleepLogsRangeStore();
    expect(store.status).toBe("idle");
    expect(store.data).toEqual([]);
    expect(store.error).toBeNull();
  });

  it("loads 7 sleep-log entries into data when GET succeeds", async () => {
    const fixture = makeSleepLogsFixture();
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toContain("/v1/sleep-logs");
      expect(url).toContain("from=2026-05-15");
      expect(url).toContain("to=2026-05-21");
      return Promise.resolve(
        new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useSleepLogsRangeStore();
    const promise = store.load(client, "2026-05-15", "2026-05-21");
    expect(store.status).toBe("loading");
    await promise;
    expect(store.status).toBe("ready");
    expect(store.data).toHaveLength(7);
    expect(store.data[0]?.slept_on).toBe("2026-05-15");
    expect(store.data[0]?.hours).toBe(7.5);
  });

  it("transitions to error on HTTP 500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useSleepLogsRangeStore();
    await store.load(client, "2026-05-15", "2026-05-21");
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });

  it("sorts data ascending by slept_on even if API returns DESC", async () => {
    // Mirror the real repo: ORDER BY slept_on DESC (newest first).
    const fixture = [...makeSleepLogsFixture()].reverse();
    expect(fixture[0]?.slept_on).toBe("2026-05-21"); // sanity: starts DESC
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useSleepLogsRangeStore();
    await store.load(client, "2026-05-15", "2026-05-22");
    // Histogram bars render left-to-right; the store hands them entries
    // in chronological order so today lands rightmost.
    expect(store.data.map((n) => n.slept_on)).toEqual([
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
    ]);
  });

  it("reload(client, from, to) re-fetches with a fresh response", async () => {
    const first = makeSleepLogsFixture();
    const second = makeSleepLogsFixture({ hours: 9.0 });
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
    const store = useSleepLogsRangeStore();
    await store.load(client, "2026-05-15", "2026-05-21");
    expect(store.data[0]?.hours).toBe(7.5);
    await store.reload(client, "2026-05-15", "2026-05-21");
    expect(store.status).toBe("ready");
    expect(store.data[0]?.hours).toBe(9.0);
  });
});

function makeSleepLogsFixture(opts: { hours?: number } = {}) {
  const firstHours = opts.hours ?? 7.5;
  return [
    {
      id: 1,
      user_id: 1,
      slept_on: "2026-05-15",
      hours: firstHours,
      quality: 4,
      notes: null,
      created_at: "2026-05-15T08:00:00Z",
    },
    {
      id: 2,
      user_id: 1,
      slept_on: "2026-05-16",
      hours: 8.0,
      quality: 5,
      notes: null,
      created_at: "2026-05-16T08:00:00Z",
    },
    {
      id: 3,
      user_id: 1,
      slept_on: "2026-05-17",
      hours: 6.5,
      quality: 3,
      notes: "late night",
      created_at: "2026-05-17T08:00:00Z",
    },
    {
      id: 4,
      user_id: 1,
      slept_on: "2026-05-18",
      hours: 7.0,
      quality: null,
      notes: null,
      created_at: "2026-05-18T08:00:00Z",
    },
    {
      id: 5,
      user_id: 1,
      slept_on: "2026-05-19",
      hours: 7.75,
      quality: 4,
      notes: null,
      created_at: "2026-05-19T08:00:00Z",
    },
    {
      id: 6,
      user_id: 1,
      slept_on: "2026-05-20",
      hours: 8.25,
      quality: 5,
      notes: null,
      created_at: "2026-05-20T08:00:00Z",
    },
    {
      id: 7,
      user_id: 1,
      slept_on: "2026-05-21",
      hours: 7.25,
      quality: 4,
      notes: null,
      created_at: "2026-05-21T08:00:00Z",
    },
  ];
}
