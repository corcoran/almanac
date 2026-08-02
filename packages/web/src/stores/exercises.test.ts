import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useExercisesStore } from "./exercises.js";

describe("useExercisesStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle", () => {
    const store = useExercisesStore();
    expect(store.status).toBe("idle");
    expect(store.exercises).toEqual([]);
    expect(store.error).toBeNull();
  });

  it("transitions idle -> loading -> ready on success", async () => {
    const fixture = makeExercisesFixture();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useExercisesStore();
    const promise = store.load(client);
    expect(store.status).toBe("loading");
    await promise;
    expect(store.status).toBe("ready");
    expect(store.exercises).toHaveLength(3);
    expect(store.exercises[0]?.name).toBe("Bench Press");
  });

  it("transitions to error on http failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useExercisesStore();
    await store.load(client);
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });
});

function makeExercisesFixture() {
  return [
    {
      id: 1,
      user_id: 1,
      group_id: 1,
      name: "Bench Press",
      notes: null,
      archived_at: null,
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: 2,
      user_id: 1,
      group_id: 2,
      name: "Barbell Row",
      notes: null,
      archived_at: null,
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: 3,
      user_id: 1,
      group_id: 3,
      name: "Back Squat",
      notes: null,
      archived_at: null,
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
}
