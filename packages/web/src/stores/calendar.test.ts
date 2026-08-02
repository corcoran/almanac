import { at } from "@almanac/core/test-support";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useCalendarStore } from "./calendar.js";

describe("useCalendarStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("returns an idle entry for months that have never been queried", () => {
    const store = useCalendarStore();
    const entry = store.entryFor("2026-05");
    expect(entry.status).toBe("idle");
  });

  it("loads the calendar for a month and transitions to ready", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/calendar\?month=2026-05$/.test(url)) {
        return Promise.resolve(jsonOk(makeMayFixture()));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useCalendarStore();
    const promise = store.loadForMonth(client, "2026-05");
    // Loading transition is observable.
    expect(store.entryFor("2026-05").status).toBe("loading");
    await promise;

    const entry = store.entryFor("2026-05");
    expect(entry.status).toBe("ready");
    if (entry.status !== "ready") throw new Error("expected ready");
    expect(entry.data.month).toBe("2026-05");
    expect(entry.data.tally.total).toBe(3);
    expect(entry.data.past_sessions).toHaveLength(3);
    expect(entry.data.pill_segments).toHaveLength(1);
    expect(at(entry.data.pill_segments, 0).template_name).toBe("PUSH A");
  });

  it("transitions to error when the endpoint returns non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useCalendarStore();
    await store.loadForMonth(client, "2026-05");
    const entry = store.entryFor("2026-05");
    expect(entry.status).toBe("error");
    if (entry.status !== "error") throw new Error("expected error");
    expect(entry.error.kind).toBe("http");
  });

  it("does not refetch when the entry is already ready", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk(makeMayFixture()));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useCalendarStore();

    await store.loadForMonth(client, "2026-05");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Second load for the same month is a cache hit — no new HTTP traffic.
    await store.loadForMonth(client, "2026-05");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reloadForMonth invalidates the cached entry and re-fetches", async () => {
    // First fetch returns May fixture; second (after reload) returns a
    // fresher snapshot with an extra past_session — verifies the cache
    // was actually dropped and the response was re-pulled.
    let phase: "first" | "second" = "first";
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/calendar\?month=2026-05$/.test(url)) {
        const body = phase === "first" ? makeMayFixture() : makeMayFixtureWithExtraSession();
        return Promise.resolve(jsonOk(body));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useCalendarStore();

    await store.loadForMonth(client, "2026-05");
    const first = store.entryFor("2026-05");
    if (first.status !== "ready") throw new Error("expected ready");
    expect(first.data.tally.total).toBe(3);

    phase = "second";
    await store.reloadForMonth(client, "2026-05");
    const second = store.entryFor("2026-05");
    if (second.status !== "ready") throw new Error("expected ready");
    expect(second.data.tally.total).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeMayFixture() {
  return {
    month: "2026-05",
    tally: {
      total: 3,
      by_template: { "PUSH A": 2, "PULL A": 1 },
    },
    past_sessions: [
      { date: "2026-05-04", workout_id: 1, template_id: 10, template_name: "PUSH A" },
      { date: "2026-05-06", workout_id: 2, template_id: 11, template_name: "PULL A" },
      { date: "2026-05-10", workout_id: 3, template_id: 10, template_name: "PUSH A" },
    ],
    pill_segments: [
      {
        template_id: 10,
        template_name: "PUSH A",
        last_hit_at: "2026-05-17T22:00:00Z",
        segments: [
          { date: "2026-05-19", phase: "acceptable" as const, is_proposed: false },
          { date: "2026-05-20", phase: "prime" as const, is_proposed: true },
          { date: "2026-05-21", phase: "prime" as const, is_proposed: false },
        ],
      },
    ],
    untracked_bands: [],
  };
}

function makeMayFixtureWithExtraSession() {
  const base = makeMayFixture();
  return {
    ...base,
    tally: { total: 4, by_template: { "PUSH A": 3, "PULL A": 1 } },
    past_sessions: [
      ...base.past_sessions,
      { date: "2026-05-17", workout_id: 4, template_id: 10, template_name: "PUSH A" },
    ],
  };
}
