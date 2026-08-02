import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useMealsStore } from "./meals.js";

describe("useMealsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle", () => {
    const store = useMealsStore();
    expect(store.status).toBe("idle");
    expect(store.data).toEqual([]);
    expect(store.error).toBeNull();
  });

  it("loads meals into data when GET succeeds", async () => {
    const fixture = makeMealsFixture();
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toContain("/v1/meals");
      expect(url).toContain("from_date=2026-05-21");
      expect(url).toContain("to_date=2026-05-21");
      return Promise.resolve(
        new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useMealsStore();
    const promise = store.load(client, "2026-05-21", "2026-05-21");
    expect(store.status).toBe("loading");
    await promise;
    expect(store.status).toBe("ready");
    expect(store.data).toHaveLength(3);
    expect(store.data[0]?.name).toBe("oatmeal");
    expect(store.data[0]?.kcal).toBe(320);
  });

  it("transitions to error on HTTP 500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useMealsStore();
    await store.load(client, "2026-05-21", "2026-05-21");
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });

  it("sorts data ascending by eaten_at even if API returns DESC", async () => {
    // Mirror the real repo: ORDER BY eaten_at DESC (newest first).
    const fixture = [...makeMealsFixture()].reverse();
    expect(fixture[0]?.name).toBe("chicken bowl"); // sanity: starts DESC
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useMealsStore();
    await store.load(client, "2026-05-21", "2026-05-21");
    // MealsList renders top-to-bottom oldest-first.
    expect(store.data.map((m) => m.name)).toEqual(["oatmeal", "protein bar", "chicken bowl"]);
  });

  it("reload(client, from, to) re-fetches with a fresh response", async () => {
    const first = makeMealsFixture();
    const second = makeMealsFixture({ firstKcal: 400 });
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
    const store = useMealsStore();
    await store.load(client, "2026-05-21", "2026-05-21");
    expect(store.data[0]?.kcal).toBe(320);
    await store.reload(client, "2026-05-21", "2026-05-21");
    expect(store.status).toBe("ready");
    expect(store.data[0]?.kcal).toBe(400);
  });
});

function makeMealsFixture(opts: { firstKcal?: number } = {}) {
  const firstKcal = opts.firstKcal ?? 320;
  return [
    {
      id: 1,
      user_id: 1,
      eaten_at: "2026-05-21T08:30:00Z",
      name: "oatmeal",
      kcal: firstKcal,
      protein_g: 12,
      carb_g: 54,
      fat_g: 6,
      notes: null,
      created_at: "2026-05-21T08:31:00Z",
    },
    {
      id: 2,
      user_id: 1,
      eaten_at: "2026-05-21T12:15:00Z",
      name: "protein bar",
      kcal: 210,
      protein_g: 20,
      carb_g: 22,
      fat_g: 7,
      notes: null,
      created_at: "2026-05-21T12:16:00Z",
    },
    {
      id: 3,
      user_id: 1,
      eaten_at: "2026-05-21T19:00:00Z",
      name: "chicken bowl",
      kcal: 650,
      protein_g: 52,
      carb_g: 60,
      fat_g: 18,
      notes: null,
      created_at: "2026-05-21T19:01:00Z",
    },
  ];
}
