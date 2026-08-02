import { at } from "@almanac/core/test-support";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useUntrackedPeriodsStore } from "./untracked-periods.js";

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PERIOD = {
  id: 1,
  user_id: 1,
  started_on: "2026-06-10",
  ended_on: "2026-06-14",
  reason: "vacation" as const,
  notes: null,
  created_at: "2026-06-09T12:00:00Z",
};

describe("useUntrackedPeriodsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("loads the list and transitions to ready", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk([PERIOD]));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useUntrackedPeriodsStore();

    const promise = store.load(client);
    expect(store.status).toBe("loading");
    await promise;

    expect(store.status).toBe("ready");
    expect(store.list).toHaveLength(1);
    expect(at(store.list, 0).reason).toBe("vacation");
  });

  it("create prepends the new period and returns ok", async () => {
    const created = { ...PERIOD, id: 2, started_on: "2026-07-01", ended_on: "2026-07-03" };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PERIOD]))
      .mockResolvedValueOnce(jsonOk(created, 201));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useUntrackedPeriodsStore();
    await store.load(client);

    const result = await store.create(client, {
      started_on: "2026-07-01",
      ended_on: "2026-07-03",
      reason: "vacation",
    });

    expect(result.ok).toBe(true);
    expect(store.list).toHaveLength(2);
    expect(at(store.list, 0).id).toBe(2);
  });

  it("create surfaces an overlap as a typed error without throwing", async () => {
    const overlapBody = {
      error: "period_overlap",
      message: "overlaps",
      conflicting_period: PERIOD,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk(overlapBody, 422));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useUntrackedPeriodsStore();

    const result = await store.create(client, {
      started_on: "2026-06-12",
      ended_on: "2026-06-13",
      reason: "vacation",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("overlap");
    expect(store.list).toHaveLength(0);
  });

  it("create surfaces a non-overlap 422 (validation) as kind 'other'", async () => {
    const validationBody = {
      error: { code: "validation_failed", message: "ended_on before started_on" },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([]))
      .mockResolvedValueOnce(jsonOk(validationBody, 422));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useUntrackedPeriodsStore();
    await store.load(client);

    const result = await store.create(client, {
      started_on: "2026-07-05",
      ended_on: "2026-07-01",
      reason: "vacation",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.kind).toBe("other");
    expect(store.list).toHaveLength(0);
  });

  it("remove deletes the period from the list", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PERIOD]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useUntrackedPeriodsStore();
    await store.load(client);

    const result = await store.remove(client, 1);

    expect(result.ok).toBe(true);
    expect(store.list).toHaveLength(0);
  });
});
