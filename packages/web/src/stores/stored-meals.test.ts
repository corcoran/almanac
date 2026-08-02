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
});
