import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useRecentWorkoutsStore } from "./recent-workouts.js";

describe("useRecentWorkoutsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle", () => {
    const store = useRecentWorkoutsStore();
    expect(store.status).toBe("idle");
    expect(store.data).toBeNull();
    expect(store.error).toBeNull();
  });

  it("transitions idle -> loading -> ready and derives counts (excluding skipped)", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/workouts\?limit=1$/.test(url)) {
        return Promise.resolve(
          new Response(JSON.stringify(makeWorkoutListFixture()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (/\/v1\/workouts\/42$/.test(url)) {
        return Promise.resolve(
          new Response(JSON.stringify(makeWorkoutDetailFixture()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useRecentWorkoutsStore();
    const promise = store.load(client);
    expect(store.status).toBe("loading");
    await promise;
    expect(store.status).toBe("ready");
    expect(store.data).toEqual({
      id: 42,
      template_id: 2,
      started_at: "2026-05-14T17:30:00Z",
      // Three exercises in the detail fixture; one is skipped. Two are counted.
      exercise_count: 2,
      // Five sets total across the two non-skipped exercises (3 + 2).
      set_count: 5,
    });
  });

  it("data stays null when the list endpoint returns an empty array", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useRecentWorkoutsStore();
    await store.load(client);
    expect(store.status).toBe("ready");
    expect(store.data).toBeNull();
  });

  it("transitions to error when the list endpoint fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useRecentWorkoutsStore();
    await store.load(client);
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });

  it("reload re-fetches and updates data with a fresh response", async () => {
    // First load returns id 42 from May 14; after a hypothetical post-submit
    // refresh, the list endpoint now returns id 43 from May 20.
    let phase: "first" | "second" = "first";
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/workouts\?limit=1$/.test(url)) {
        const list = phase === "first" ? makeWorkoutListFixture() : makeSecondListFixture();
        return Promise.resolve(jsonOk(list));
      }
      if (/\/v1\/workouts\/42$/.test(url)) {
        return Promise.resolve(jsonOk(makeWorkoutDetailFixture()));
      }
      if (/\/v1\/workouts\/43$/.test(url)) {
        return Promise.resolve(jsonOk(makeSecondDetailFixture()));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useRecentWorkoutsStore();

    await store.load(client);
    expect(store.data?.id).toBe(42);
    expect(store.data?.started_at).toBe("2026-05-14T17:30:00Z");

    // Simulate the post-submit world: a newer workout exists now.
    phase = "second";
    await store.reload(client);
    expect(store.status).toBe("ready");
    expect(store.data?.id).toBe(43);
    expect(store.data?.started_at).toBe("2026-05-20T19:00:00Z");
    // One set on one non-skipped exercise in the second fixture.
    expect(store.data?.exercise_count).toBe(1);
    expect(store.data?.set_count).toBe(1);
  });

  it("transitions to error when the detail endpoint fails", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/workouts\?limit=1$/.test(url)) {
        return Promise.resolve(
          new Response(JSON.stringify(makeWorkoutListFixture()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("boom", { status: 500 }));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useRecentWorkoutsStore();
    await store.load(client);
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });
});

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeSecondListFixture() {
  return [
    {
      id: 43,
      user_id: 1,
      template_id: 2,
      started_at: "2026-05-20T19:00:00Z",
      duration_min: 45,
      rpe: 8,
      est_kcal: 280,
      notes: null,
      created_at: "2026-05-20T19:00:00Z",
    },
  ];
}

function makeSecondDetailFixture() {
  return {
    id: 43,
    user_id: 1,
    template_id: 2,
    started_at: "2026-05-20T19:00:00Z",
    duration_min: 45,
    rpe: 8,
    est_kcal: 280,
    notes: null,
    created_at: "2026-05-20T19:00:00Z",
    exercises: [
      {
        id: 201,
        workout_id: 43,
        exercise_id: 10,
        display_order: 0,
        planned_sets: 1,
        notes: null,
        skipped_at: null,
        sets: [
          {
            id: 2001,
            exercise_instance_id: 201,
            set_number: 1,
            reps: 5,
            weight_kg: 100,
            notes: null,
          },
        ],
      },
    ],
  };
}

function makeWorkoutListFixture() {
  // The list endpoint omits nested exercises[].
  return [
    {
      id: 42,
      user_id: 1,
      template_id: 2,
      started_at: "2026-05-14T17:30:00Z",
      duration_min: 58,
      rpe: 7.5,
      est_kcal: 320,
      notes: null,
      created_at: "2026-05-14T17:30:00Z",
    },
  ];
}

function makeWorkoutDetailFixture() {
  // Detail endpoint returns nested exercises[]. One exercise is skipped
  // (skipped_at non-null), so it's dropped from both counts to match the
  // stim signal's policy documented in last-session-shape.sh.
  return {
    id: 42,
    user_id: 1,
    template_id: 2,
    started_at: "2026-05-14T17:30:00Z",
    duration_min: 58,
    rpe: 7.5,
    est_kcal: 320,
    notes: null,
    created_at: "2026-05-14T17:30:00Z",
    exercises: [
      {
        id: 101,
        workout_id: 42,
        exercise_id: 10,
        display_order: 0,
        planned_sets: 3,
        notes: null,
        skipped_at: null,
        sets: [
          {
            id: 1001,
            exercise_instance_id: 101,
            set_number: 1,
            reps: 8,
            weight_kg: 70,
            notes: null,
          },
          {
            id: 1002,
            exercise_instance_id: 101,
            set_number: 2,
            reps: 8,
            weight_kg: 70,
            notes: null,
          },
          {
            id: 1003,
            exercise_instance_id: 101,
            set_number: 3,
            reps: 7,
            weight_kg: 70,
            notes: null,
          },
        ],
      },
      {
        id: 102,
        workout_id: 42,
        exercise_id: 11,
        display_order: 1,
        planned_sets: 2,
        notes: null,
        skipped_at: null,
        sets: [
          {
            id: 1004,
            exercise_instance_id: 102,
            set_number: 1,
            reps: 10,
            weight_kg: 40,
            notes: null,
          },
          {
            id: 1005,
            exercise_instance_id: 102,
            set_number: 2,
            reps: 10,
            weight_kg: 40,
            notes: null,
          },
        ],
      },
      {
        id: 103,
        workout_id: 42,
        exercise_id: 12,
        display_order: 2,
        planned_sets: 3,
        notes: null,
        // Skipped row — must be excluded from both counts.
        skipped_at: "2026-05-14T18:10:00Z",
        sets: [],
      },
    ],
  };
}
