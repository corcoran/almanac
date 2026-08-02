import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useTemplateLastSessionsStore } from "./template-last-sessions.js";

const NAME_LOOKUP = (id: number): string =>
  ({ 10: "Bench Press", 11: "Overhead Press", 12: "Tricep Pushdown" })[id] ?? "(unknown)";

describe("useTemplateLastSessionsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("returns an idle entry for templates that have never been queried", () => {
    const store = useTemplateLastSessionsStore();
    const entry = store.entryFor(99);
    expect(entry.status).toBe("idle");
  });

  it("loads list + detail, denormalizes exercise names, and flags skipped rows", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/workouts\?template_id=2&limit=1$/.test(url)) {
        return Promise.resolve(jsonOk(makeListFixture()));
      }
      if (/\/v1\/workouts\/42$/.test(url)) {
        return Promise.resolve(jsonOk(makeDetailFixture()));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTemplateLastSessionsStore();
    const promise = store.loadForTemplate(client, 2, NAME_LOOKUP);
    // Verify the loading transition is observable.
    expect(store.entryFor(2).status).toBe("loading");
    await promise;

    const entry = store.entryFor(2);
    expect(entry.status).toBe("ready");
    if (entry.status !== "ready") throw new Error("expected ready");
    expect(entry.data).not.toBeNull();
    if (entry.data === null) throw new Error("expected non-null data");
    expect(entry.data.workout_id).toBe(42);
    expect(entry.data.started_at).toBe("2026-05-14T17:30:00Z");
    expect(entry.data.rpe).toBe(7.5);
    // Three rows in the fixture (one skipped). All three carry through;
    // the panel filters skipped at render time.
    expect(entry.data.exercises).toHaveLength(3);
    expect(entry.data.exercises[0]).toEqual({
      exercise_id: 10,
      exercise_name: "Bench Press",
      skipped: false,
      sets: [
        { reps: 8, weight_kg: 80 },
        { reps: 8, weight_kg: 82.5 },
      ],
    });
    expect(entry.data.exercises[2]).toMatchObject({
      exercise_id: 12,
      exercise_name: "Tricep Pushdown",
      skipped: true,
    });
  });

  it("marks the entry ready with null data when the list endpoint returns []", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk([]));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTemplateLastSessionsStore();
    await store.loadForTemplate(client, 7, NAME_LOOKUP);
    const entry = store.entryFor(7);
    expect(entry.status).toBe("ready");
    if (entry.status !== "ready") throw new Error("expected ready");
    expect(entry.data).toBeNull();
    // Only one fetch — no detail call when the list is empty.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("transitions to error when the list endpoint fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTemplateLastSessionsStore();
    await store.loadForTemplate(client, 2, NAME_LOOKUP);
    const entry = store.entryFor(2);
    expect(entry.status).toBe("error");
    if (entry.status !== "error") throw new Error("expected error");
    expect(entry.error.kind).toBe("http");
  });

  it("transitions to error when the detail endpoint fails", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/workouts\?template_id=2&limit=1$/.test(url)) {
        return Promise.resolve(jsonOk(makeListFixture()));
      }
      return Promise.resolve(new Response("boom", { status: 500 }));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTemplateLastSessionsStore();
    await store.loadForTemplate(client, 2, NAME_LOOKUP);
    const entry = store.entryFor(2);
    expect(entry.status).toBe("error");
    if (entry.status !== "error") throw new Error("expected error");
    expect(entry.error.kind).toBe("http");
  });

  it("invalidate clears the cached entry", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/workouts\?template_id=2&limit=1$/.test(url)) {
        return Promise.resolve(jsonOk(makeListFixture()));
      }
      if (/\/v1\/workouts\/42$/.test(url)) {
        return Promise.resolve(jsonOk(makeDetailFixture()));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTemplateLastSessionsStore();
    await store.loadForTemplate(client, 2, NAME_LOOKUP);
    expect(store.entryFor(2).status).toBe("ready");

    store.invalidate(2);
    expect(store.entryFor(2).status).toBe("idle");
  });

  it("reloadForTemplate re-fetches even when the entry is ready", async () => {
    // Two-stage fetch: first call returns workout 42, after invalidate the
    // list endpoint now points at a fresher workout id 99.
    let phase: "first" | "second" = "first";
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/workouts\?template_id=2&limit=1$/.test(url)) {
        const list = phase === "first" ? makeListFixture() : makeSecondListFixture();
        return Promise.resolve(jsonOk(list));
      }
      if (/\/v1\/workouts\/42$/.test(url)) {
        return Promise.resolve(jsonOk(makeDetailFixture()));
      }
      if (/\/v1\/workouts\/99$/.test(url)) {
        return Promise.resolve(jsonOk(makeSecondDetailFixture()));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTemplateLastSessionsStore();

    await store.loadForTemplate(client, 2, NAME_LOOKUP);
    const first = store.entryFor(2);
    if (first.status !== "ready" || first.data === null) throw new Error("expected ready+data");
    expect(first.data.workout_id).toBe(42);

    phase = "second";
    await store.reloadForTemplate(client, 2, NAME_LOOKUP);
    const second = store.entryFor(2);
    if (second.status !== "ready" || second.data === null) throw new Error("expected ready+data");
    expect(second.data.workout_id).toBe(99);
    expect(second.data.started_at).toBe("2026-05-20T19:00:00Z");
  });

  it("does not refetch when the entry is already ready", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/v1\/workouts\?template_id=2&limit=1$/.test(url)) {
        return Promise.resolve(jsonOk(makeListFixture()));
      }
      if (/\/v1\/workouts\/42$/.test(url)) {
        return Promise.resolve(jsonOk(makeDetailFixture()));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTemplateLastSessionsStore();
    await store.loadForTemplate(client, 2, NAME_LOOKUP);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await store.loadForTemplate(client, 2, NAME_LOOKUP);
    // Second call is a cache hit — no additional HTTP traffic.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
      id: 99,
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
    id: 99,
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
        workout_id: 99,
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

function makeListFixture() {
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

function makeDetailFixture() {
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
        planned_sets: 2,
        notes: null,
        skipped_at: null,
        sets: [
          {
            id: 1001,
            exercise_instance_id: 101,
            set_number: 1,
            reps: 8,
            weight_kg: 80,
            notes: null,
          },
          {
            id: 1002,
            exercise_instance_id: 101,
            set_number: 2,
            reps: 8,
            weight_kg: 82.5,
            notes: null,
          },
        ],
      },
      {
        id: 102,
        workout_id: 42,
        exercise_id: 11,
        display_order: 1,
        planned_sets: 3,
        notes: null,
        skipped_at: null,
        sets: [
          {
            id: 1003,
            exercise_instance_id: 102,
            set_number: 1,
            reps: 6,
            weight_kg: 50,
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
        // Skipped row — store carries it through with skipped: true; panel
        // filters it at render time.
        skipped_at: "2026-05-14T18:10:00Z",
        sets: [],
      },
    ],
  };
}
