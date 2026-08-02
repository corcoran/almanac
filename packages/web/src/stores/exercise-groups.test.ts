import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useExerciseGroupsStore } from "./exercise-groups.js";

describe("useExerciseGroupsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle", () => {
    const store = useExerciseGroupsStore();
    expect(store.status).toBe("idle");
    expect(store.groups).toEqual([]);
    expect(store.error).toBeNull();
  });

  it("transitions idle -> loading -> ready on success", async () => {
    const fixture = makeExerciseGroupsFixture();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useExerciseGroupsStore();
    const promise = store.load(client);
    expect(store.status).toBe("loading");
    await promise;
    expect(store.status).toBe("ready");
    expect(store.groups).toHaveLength(3);
    expect(store.groups[0]?.name).toBe("chest");
  });

  it("transitions to error on http failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useExerciseGroupsStore();
    await store.load(client);
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });
});

function makeExerciseGroupsFixture() {
  return [
    {
      id: 1,
      user_id: 1,
      name: "chest",
      display_order: 0,
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: 2,
      user_id: 1,
      name: "back",
      display_order: 1,
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: 3,
      user_id: 1,
      name: "legs",
      display_order: 2,
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
}
