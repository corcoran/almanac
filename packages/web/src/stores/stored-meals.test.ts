import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStoredMealsStore } from "./stored-meals.js";

function makeStored(overrides = {}) {
  return {
    id: 1,
    user_id: 1,
    name: "My usual breakfast",
    kcal: 520,
    protein_g: 32,
    carb_g: 50,
    fat_g: 18,
    description: null,
    created_at: "2026-06-01T00:00:00Z",
    recent_uses: 0,
    last_used_at: null,
    ...overrides,
  };
}

describe("useStoredMealsStore", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("loads and sorts stored meals by name", async () => {
    const client = {
      get: vi
        .fn()
        .mockResolvedValue([
          makeStored({ id: 2, name: "Zucchini bowl" }),
          makeStored({ id: 1, name: "Apple oats" }),
        ]),
    } as unknown as import("../api/client.js").ApiClient;
    const store = useStoredMealsStore();
    await store.load(client);
    expect(store.status).toBe("ready");
    expect(store.data.map((m) => m.name)).toEqual(["Apple oats", "Zucchini bowl"]);
    expect(client.get).toHaveBeenCalledWith("/v1/stored-meals", expect.anything());
  });

  it("sets error status on ApiError", async () => {
    const apiErr = { kind: "http", status: 500, body: "" };
    const client = {
      get: vi.fn().mockRejectedValue(apiErr),
    } as unknown as import("../api/client.js").ApiClient;
    const store = useStoredMealsStore();
    await store.load(client);
    expect(store.status).toBe("error");
    expect(store.error).toEqual(apiErr);
  });

  describe("recent / rest split", () => {
    async function loaded(rows: ReturnType<typeof makeStored>[]) {
      const client = {
        get: vi.fn().mockResolvedValue(rows),
      } as unknown as import("../api/client.js").ApiClient;
      const store = useStoredMealsStore();
      await store.load(client);
      return store;
    }
    const used = (id: number, name: string, recent_uses: number, last_used_at: string) =>
      makeStored({ id, name, recent_uses, last_used_at });

    it("orders recent by use count, then latest use, then name", async () => {
      const store = await loaded([
        used(1, "Apple oats", 1, "2026-09-20T12:00:00Z"),
        used(2, "Burrito", 3, "2026-09-10T12:00:00Z"),
        used(3, "Chili", 1, "2026-09-28T12:00:00Z"),
        used(4, "Dal", 1, "2026-09-20T12:00:00Z"),
      ]);
      expect(store.recent.map((m) => m.name)).toEqual(["Burrito", "Chili", "Apple oats", "Dal"]);
    });

    it("keeps unused meals alphabetical in rest, never duplicating recent ones", async () => {
      const store = await loaded([
        makeStored({ id: 1, name: "Zucchini bowl" }),
        used(2, "Burrito", 2, "2026-09-20T12:00:00Z"),
        makeStored({ id: 3, name: "Apple oats" }),
      ]);
      expect(store.recent.map((m) => m.name)).toEqual(["Burrito"]);
      expect(store.rest.map((m) => m.name)).toEqual(["Apple oats", "Zucchini bowl"]);
    });

    it("caps recent at 10 and drops the overflow into rest", async () => {
      const rows = Array.from({ length: 12 }, (_, i) =>
        used(i + 1, `Meal ${String(i + 1).padStart(2, "0")}`, 12 - i, "2026-09-20T12:00:00Z"),
      );
      const store = await loaded(rows);
      expect(store.recent).toHaveLength(10);
      expect(store.rest.map((m) => m.name)).toEqual(["Meal 11", "Meal 12"]);
    });
  });

  it("remembers whether the list is expanded", () => {
    const store = useStoredMealsStore();
    expect(store.expanded).toBe(false);
    store.toggleExpanded();
    expect(store.expanded).toBe(true);
  });
});
