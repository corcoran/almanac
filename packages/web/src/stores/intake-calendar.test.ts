import { at } from "@almanac/core/test-support";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useIntakeCalendarStore } from "./intake-calendar.js";

const TODAY = "2026-06-10";

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeDay(date: string) {
  return {
    date,
    day_totals: {
      kcal: 1914,
      protein_g: 150,
      carb_g: 180,
      fat_g: 60,
      kcal_from_food: 1914,
      kcal_from_alcohol: 0,
    },
    day_target: null,
    net_kcal: null,
    untracked: false,
  };
}

describe("useIntakeCalendarStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("returns an idle entry for months never queried", () => {
    const store = useIntakeCalendarStore();
    expect(store.entryFor("2026-06").status).toBe("idle");
  });

  it("fetches the current month clamped to today and transitions to ready", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/signals\/macros\?from_date=2026-06-01&to_date=2026-06-10$/.test(url)) {
        return Promise.resolve(jsonOk({ days: [makeDay("2026-06-01")] }));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useIntakeCalendarStore();

    const promise = store.loadForMonth(client, "2026-06", TODAY);
    expect(store.entryFor("2026-06").status).toBe("loading");
    await promise;

    const entry = store.entryFor("2026-06");
    expect(entry.status).toBe("ready");
    if (entry.status !== "ready") throw new Error("expected ready");
    expect(at(entry.data.days, 0).date).toBe("2026-06-01");
  });

  it("fetches a past month over its full window", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/signals\/macros\?from_date=2026-05-01&to_date=2026-05-31$/.test(url)) {
        return Promise.resolve(jsonOk({ days: [makeDay("2026-05-01")] }));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useIntakeCalendarStore();
    await store.loadForMonth(client, "2026-05", TODAY);
    expect(store.entryFor("2026-05").status).toBe("ready");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("clamps February to its actual last day", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/from_date=2026-02-01&to_date=2026-02-28$/.test(url)) {
        return Promise.resolve(jsonOk({ days: [] }));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useIntakeCalendarStore();
    await store.loadForMonth(client, "2026-02", TODAY);
    expect(store.entryFor("2026-02").status).toBe("ready");
  });

  it("resolves an entirely-future month to ready with empty days, no fetch", async () => {
    const fetchImpl = vi.fn();
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useIntakeCalendarStore();
    await store.loadForMonth(client, "2026-07", TODAY);
    const entry = store.entryFor("2026-07");
    expect(entry.status).toBe("ready");
    if (entry.status !== "ready") throw new Error("expected ready");
    expect(entry.data.days).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not refetch an already-ready month", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk({ days: [] }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useIntakeCalendarStore();
    await store.loadForMonth(client, "2026-05", TODAY);
    await store.loadForMonth(client, "2026-05", TODAY);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reloadForMonth invalidates the cached entry and re-fetches", async () => {
    let phase: "first" | "second" = "first";
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/signals\/macros\?/.test(url)) {
        const days =
          phase === "first"
            ? [makeDay("2026-05-01")]
            : [{ ...makeDay("2026-05-01"), untracked: true }];
        return Promise.resolve(jsonOk({ days }));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useIntakeCalendarStore();

    await store.loadForMonth(client, "2026-05", "2026-05-31");
    const first = store.entryFor("2026-05");
    if (first.status !== "ready") throw new Error("expected ready");
    expect(at(first.data.days, 0).untracked).toBe(false);

    phase = "second";
    await store.reloadForMonth(client, "2026-05", "2026-05-31");
    const second = store.entryFor("2026-05");
    if (second.status !== "ready") throw new Error("expected ready");
    expect(at(second.data.days, 0).untracked).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("transitions to error on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useIntakeCalendarStore();
    await store.loadForMonth(client, "2026-05", TODAY);
    const entry = store.entryFor("2026-05");
    expect(entry.status).toBe("error");
    if (entry.status !== "error") throw new Error("expected error");
    expect(entry.error.kind).toBe("http");
  });
});
