import { at, defined } from "@almanac/core/test-support";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import type { TemplateBaseline } from "../lib/active-workout-types.js";
import { LOCAL_STORAGE_KEY } from "../lib/localStorageAdapter.js";
import { useWorkoutStore } from "./workout.js";

// Fixed naive-local start timestamp for tests; startSession now takes it explicitly.
const TEST_STARTED_AT = "2026-05-19T13:00:00";

// The store's `active` session is `T | null`; every test that reaches into it
// has already started a session, so narrow once here with a clear error if the
// invariant is ever violated, instead of asserting at each access.
function activeOf(store: ReturnType<typeof useWorkoutStore>) {
  return defined(store.active, "active workout session");
}

const baseline: TemplateBaseline = {
  template_id: 1,
  template_name: "PUSH A",
  exercises: [
    {
      exercise_id: 10,
      name: "Bench Press",
      group_id: 1,
      display_order: 1,
      planned_sets: 3,
      default_reps: 8,
      default_weight_kg: 80,
    },
    {
      exercise_id: 11,
      name: "Overhead Press",
      group_id: 2,
      display_order: 2,
      planned_sets: 3,
      default_reps: 6,
      default_weight_kg: 50,
    },
  ],
};

describe("useWorkoutStore — mutations", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("starts with hasActiveSession=false", () => {
    const store = useWorkoutStore();
    expect(store.hasActiveSession).toBe(false);
    expect(store.active).toBeNull();
  });

  it("startSession initializes from baseline and persists to localStorage", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    expect(store.hasActiveSession).toBe(true);
    expect(store.active?.exercises).toHaveLength(2);
    expect(store.active?.exercises[0]?.exercise_id).toBe(10);
    expect(store.active?.exercises[0]?.sets).toHaveLength(3);
    expect(store.active?.exercises[0]?.sets[0]).toMatchObject({
      set_number: 1,
      reps: 8,
      weight_kg: 80,
      done: false,
    });
    expect(store.active?.rpe).toBeNull();
    // started_at is stored verbatim from the caller — a naive-local string
    // (no `Z`), NOT a UTC toISOString(). This is what lets the API bucket the
    // workout onto the user's actual day instead of tomorrow.
    expect(store.active?.started_at).toBe(TEST_STARTED_AT);
    expect(store.active?.started_at).not.toMatch(/Z$/);
    // Persisted
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).not.toBeNull();
  });

  it("tickSet marks a set done and persists", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    store.tickSet(at(activeOf(store).exercises, 0).client_id, 1);
    expect(store.active?.exercises[0]?.sets[0]?.done).toBe(true);
    // Persisted
    const raw = JSON.parse(defined(localStorage.getItem(LOCAL_STORAGE_KEY), "localStorage entry"));
    expect(raw.exercises[0].sets[0].done).toBe(true);
  });

  it("tickSet seeds the next not-yet-completed set with the ticked set's actuals", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    const cid = at(activeOf(store).exercises, 0).client_id;
    // User worked set 1 differently than the template default.
    store.editSet(cid, 1, { reps: 10, weight_kg: 82.5 });
    store.tickSet(cid, 1);
    // Set 2 (still done:false) should now mirror set 1's actuals.
    expect(store.active?.exercises[0]?.sets[1]).toMatchObject({
      set_number: 2,
      reps: 10,
      weight_kg: 82.5,
      done: false,
    });
    // Set 3 untouched (still template defaults).
    expect(store.active?.exercises[0]?.sets[2]).toMatchObject({
      set_number: 3,
      reps: 8,
      weight_kg: 80,
    });
  });

  it("tickSet inheritance does not overwrite a manually-edited downstream set", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    const cid = at(activeOf(store).exercises, 0).client_id;
    // Tick set 1 with reps=8 (matches default → set 2 inherits 8).
    store.tickSet(cid, 1);
    expect(at(at(activeOf(store).exercises, 0).sets, 1).reps).toBe(8);
    // User manually edits set 2 to reps=9.
    store.editSet(cid, 2, { reps: 9 });
    // User unticks set 1, edits it to reps=10, re-ticks.
    store.untickSet(cid, 1);
    store.editSet(cid, 1, { reps: 10 });
    store.tickSet(cid, 1);
    // Set 2's manual edit (reps=9) must be preserved, NOT clobbered with 10.
    expect(at(at(activeOf(store).exercises, 0).sets, 1).reps).toBe(9);
  });

  it("tickSet inheritance skips already-completed sets and lands on the next undone one", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    const cid = at(activeOf(store).exercises, 0).client_id;
    // Pre-complete set 2 with a distinct value. Set 3 is still default → its
    // inheritance from set 2 fires now, so it becomes {11, 90}.
    store.editSet(cid, 2, { reps: 11, weight_kg: 90 });
    store.tickSet(cid, 2);
    expect(store.active?.exercises[0]?.sets[2]).toMatchObject({ reps: 11, weight_kg: 90 });
    // Now tick set 1 with a different value. Should NOT overwrite set 2 (done),
    // and should NOT overwrite set 3 either — set 3 has already been seeded
    // from set 2's values and is no longer at template defaults.
    store.editSet(cid, 1, { reps: 8, weight_kg: 82.5 });
    store.tickSet(cid, 1);
    expect(store.active?.exercises[0]?.sets[1]).toMatchObject({ reps: 11, weight_kg: 90 });
    expect(store.active?.exercises[0]?.sets[2]).toMatchObject({ reps: 11, weight_kg: 90 });
  });

  it("editSet updates reps/weight before tick", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    const cid = at(activeOf(store).exercises, 0).client_id;
    store.editSet(cid, 1, { reps: 10, weight_kg: 85 });
    expect(store.active?.exercises[0]?.sets[0]).toMatchObject({ reps: 10, weight_kg: 85 });
  });

  it("addSet appends a set pre-filled from the prior set's actuals", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    const cid = at(activeOf(store).exercises, 0).client_id;
    store.editSet(cid, 1, { reps: 8, weight_kg: 82.5 });
    store.tickSet(cid, 1);
    store.addSet(cid);
    // First exercise now has 4 sets (3 planned + 1 added).
    expect(store.active?.exercises[0]?.sets).toHaveLength(4);
    expect(store.active?.exercises[0]?.sets[3]).toMatchObject({
      set_number: 4,
      reps: 8, // from set 1 actuals
      weight_kg: 82.5,
      done: false,
    });
  });

  it("addExercise appends a new exercise marked added_mid_session", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    store.addExercise({ exercise_id: 99, name: "Cable Crossover", group_id: 1 });
    expect(store.active?.exercises).toHaveLength(3);
    expect(store.active?.exercises[2]).toMatchObject({
      exercise_id: 99,
      added_mid_session: true,
      baseline_planned_sets: 0,
      sets: [{ set_number: 1, reps: 0, weight_kg: null, done: false }],
    });
  });

  it("skipExercise marks skipped and persists", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    store.skipExercise(at(activeOf(store).exercises, 1).client_id);
    expect(store.active?.exercises[1]?.skipped).toBe(true);
  });

  it("setRpe updates RPE", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    store.setRpe(7);
    expect(store.active?.rpe).toBe(7);
  });

  it("setRpe accepts null to clear", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    store.setRpe(8);
    expect(activeOf(store).rpe).toBe(8);
    store.setRpe(null);
    expect(activeOf(store).rpe).toBeNull();
  });

  it("hydrate restores from localStorage", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    setActivePinia(createPinia()); // wipe in-memory state
    const fresh = useWorkoutStore();
    expect(fresh.hasActiveSession).toBe(false);
    fresh.hydrate();
    expect(fresh.hasActiveSession).toBe(true);
    expect(fresh.active?.template_id).toBe(1);
  });

  it("cancelSession clears localStorage and resets state", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    store.cancelSession();
    expect(store.hasActiveSession).toBe(false);
    expect(store.active).toBeNull();
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeNull();
  });
});

describe("useWorkoutStore — submit", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  function makeWorkoutResponseBody(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 42,
      user_id: 1,
      template_id: 1,
      started_at: "2026-05-19T17:00:00Z",
      duration_min: null,
      rpe: 8,
      est_kcal: null,
      notes: null,
      created_at: "2026-05-19T17:30:00Z",
      ...overrides,
    };
  }

  function makeTemplateResponseBody() {
    return {
      id: 1,
      user_id: 1,
      name: "PUSH A",
      notes: null,
      archived_at: null,
      created_at: "2026-05-19T17:30:00Z",
      items: [],
    };
  }

  function makeClient(opts: {
    workoutResponse?: { status: number; body: unknown };
    templatePutResponse?: { status: number; body: unknown };
  }): { client: ApiClient; fetchImpl: ReturnType<typeof vi.fn> } {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/v1/workouts") && opts.workoutResponse) {
        return new Response(JSON.stringify(opts.workoutResponse.body), {
          status: opts.workoutResponse.status,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.match(/\/v1\/workout-templates\/\d+\/items/) && opts.templatePutResponse) {
        return new Response(JSON.stringify(opts.templatePutResponse.body), {
          status: opts.templatePutResponse.status,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not mocked", { status: 500 });
    });
    return { client: new ApiClient({ baseUrl: "/api", fetchImpl }), fetchImpl };
  }

  it("endSession with no divergences POSTs the workout and clears localStorage", async () => {
    const { client, fetchImpl } = makeClient({
      workoutResponse: { status: 201, body: makeWorkoutResponseBody() },
    });
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    // Complete every planned set exactly as baseline says
    for (const ex of activeOf(store).exercises) {
      for (const s of ex.sets) {
        store.tickSet(ex.client_id, s.set_number);
      }
    }
    store.setRpe(8);

    const result = await store.endSession(client, {
      saveChoice: "none",
      duration_min: 45,
    });

    expect(result.status).toBe("submitted");
    if (result.status === "submitted") {
      expect(result.workout_id).toBe(42);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1); // workouts POST only — no template PUT
    expect(store.active).toBeNull();
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeNull();

    // duration_min from the opts must land in the POST body. This is the
    // whole point of the field — without it, downstream signals
    // (workout_kcal fallback in daily-target.ts, HR-derived cardio
    // estimator analogue) silently degrade to zero.
    const postCall = fetchImpl.mock.calls.find(([u]) => String(u).endsWith("/v1/workouts"));
    const body = JSON.parse((defined(postCall, "postCall")[1] as RequestInit).body as string);
    expect(body.duration_min).toBe(45);
  });

  it("endSession with saveChoice=all PUTs template items after POST workout", async () => {
    const { client, fetchImpl } = makeClient({
      workoutResponse: { status: 201, body: makeWorkoutResponseBody() },
      templatePutResponse: { status: 200, body: makeTemplateResponseBody() },
    });
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    // Bump bench press weight to create a set_changes divergence
    const benchCid = at(activeOf(store).exercises, 0).client_id;
    for (const s of at(activeOf(store).exercises, 0).sets) {
      store.editSet(benchCid, s.set_number, { reps: 8, weight_kg: 82.5 });
      store.tickSet(benchCid, s.set_number);
    }
    // Complete overhead as-is
    const ohpCid = at(activeOf(store).exercises, 1).client_id;
    for (const s of at(activeOf(store).exercises, 1).sets) {
      store.tickSet(ohpCid, s.set_number);
    }
    store.setRpe(7);

    const result = await store.endSession(client, {
      saveChoice: "all",
      duration_min: 50,
    });

    expect(result.status).toBe("submitted");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // POST workouts + PUT items
    const putCall = fetchImpl.mock.calls.find(([u]) => {
      const url = typeof u === "string" ? u : u.toString();
      return url.match(/\/v1\/workout-templates\/\d+\/items/);
    });
    expect(putCall).toBeDefined();
    expect(store.active).toBeNull();
  });

  it("endSession on workout POST failure marks pending_submit and keeps state", async () => {
    const { client } = makeClient({
      workoutResponse: { status: 500, body: { error: "x" } },
    });
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    store.setRpe(8);

    const result = await store.endSession(client, {
      saveChoice: "none",
      duration_min: 30,
    });

    expect(result.status).toBe("workout_failed");
    expect(store.active?.pending_submit).toBe(true);
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).not.toBeNull();
  });

  it("includes skipped exercises in the workout body with empty sets", async () => {
    const { client, fetchImpl } = makeClient({
      workoutResponse: { status: 201, body: makeWorkoutResponseBody() },
    });
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    // Complete bench fully
    const benchCid = at(activeOf(store).exercises, 0).client_id;
    for (const s of at(activeOf(store).exercises, 0).sets) store.tickSet(benchCid, s.set_number);
    // Skip overhead
    store.skipExercise(at(activeOf(store).exercises, 1).client_id);
    store.setRpe(8);

    const result = await store.endSession(client, {
      saveChoice: "none",
      duration_min: 40,
    });
    expect(result.status).toBe("submitted");

    // Inspect the POST body
    const postCall = fetchImpl.mock.calls.find(([u]) => String(u).endsWith("/v1/workouts"));
    expect(postCall).toBeDefined();
    const body = JSON.parse((defined(postCall, "postCall")[1] as RequestInit).body as string);
    expect(body.exercises).toHaveLength(2);
    const ohp = body.exercises.find((e: { exercise_id: number }) => e.exercise_id === 11);
    expect(ohp).toBeDefined();
    expect(ohp.sets).toEqual([]);
  });

  it("omits added-mid-session exercises that have no completed sets from the workout body", async () => {
    const { client, fetchImpl } = makeClient({
      workoutResponse: { status: 201, body: makeWorkoutResponseBody() },
    });
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    // Complete the planned exercises normally
    for (const ex of activeOf(store).exercises) {
      for (const s of ex.sets) store.tickSet(ex.client_id, s.set_number);
    }
    // Add a new exercise but DON'T tick any sets on it
    store.addExercise({ exercise_id: 99, name: "Cable Crossover", group_id: 1 });
    store.setRpe(8);

    const result = await store.endSession(client, {
      saveChoice: "none",
      duration_min: 35,
    });
    expect(result.status).toBe("submitted");

    // Inspect POST body
    const postCall = fetchImpl.mock.calls.find(([u]) => String(u).endsWith("/v1/workouts"));
    const body = JSON.parse((defined(postCall, "postCall")[1] as RequestInit).body as string);
    expect(body.exercises).toHaveLength(2); // only the two baseline exercises
    expect(
      body.exercises.find((e: { exercise_id: number }) => e.exercise_id === 99),
    ).toBeUndefined();
  });

  it("endSession on template PUT failure marks pending_template_patch (workout already submitted)", async () => {
    const { client } = makeClient({
      workoutResponse: { status: 201, body: makeWorkoutResponseBody() },
      templatePutResponse: { status: 500, body: { error: "x" } },
    });
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    const benchCid = at(activeOf(store).exercises, 0).client_id;
    for (const s of at(activeOf(store).exercises, 0).sets) {
      store.editSet(benchCid, s.set_number, { reps: 8, weight_kg: 82.5 });
      store.tickSet(benchCid, s.set_number);
    }
    store.setRpe(8);

    const result = await store.endSession(client, {
      saveChoice: "all",
      duration_min: 55,
    });

    expect(result.status).toBe("template_failed");
    if (result.status === "template_failed") {
      expect(result.workout_id).toBe(42);
    }
    expect(store.active?.pending_template_patch?.workout_id).toBe(42);
    expect(store.active?.pending_submit).toBeUndefined();
  });

  it("endSession on retry after partial failure replays only the PUT", async () => {
    // First attempt: POST succeeds, PUT fails.
    const { client: client1 } = makeClient({
      workoutResponse: { status: 201, body: makeWorkoutResponseBody() },
      templatePutResponse: { status: 500, body: { error: "x" } },
    });
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    const benchCid = at(activeOf(store).exercises, 0).client_id;
    for (const s of at(activeOf(store).exercises, 0).sets) {
      store.editSet(benchCid, s.set_number, { reps: 8, weight_kg: 82.5 });
      store.tickSet(benchCid, s.set_number);
    }
    for (const s of at(activeOf(store).exercises, 1).sets) {
      store.tickSet(at(activeOf(store).exercises, 1).client_id, s.set_number);
    }
    store.setRpe(8);
    const first = await store.endSession(client1, {
      saveChoice: "all",
      duration_min: 50,
    });
    expect(first.status).toBe("template_failed");
    expect(store.active?.pending_template_patch?.workout_id).toBe(42);

    // Second attempt: PUT succeeds. Should NOT re-POST the workout.
    const { client: client2, fetchImpl: fetchImpl2 } = makeClient({
      templatePutResponse: { status: 200, body: makeTemplateResponseBody() },
    });
    const second = await store.endSession(client2, {
      saveChoice: "all",
      duration_min: 50,
    });
    expect(second.status).toBe("submitted");
    if (second.status === "submitted") expect(second.workout_id).toBe(42);

    // Verify no POST to /v1/workouts on retry — only the PUT
    const postCalls = fetchImpl2.mock.calls.filter(([u]) => String(u).endsWith("/v1/workouts"));
    expect(postCalls).toEqual([]);
    expect(store.active).toBeNull();
  });

  it("endSession on retry after partial failure with saveChoice=none clears cleanly", async () => {
    // First attempt: POST succeeds, PUT fails.
    const { client: client1 } = makeClient({
      workoutResponse: { status: 201, body: makeWorkoutResponseBody() },
      templatePutResponse: { status: 500, body: { error: "x" } },
    });
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    const benchCid = at(activeOf(store).exercises, 0).client_id;
    for (const s of at(activeOf(store).exercises, 0).sets) {
      store.editSet(benchCid, s.set_number, { reps: 8, weight_kg: 82.5 });
      store.tickSet(benchCid, s.set_number);
    }
    for (const s of at(activeOf(store).exercises, 1).sets) {
      store.tickSet(at(activeOf(store).exercises, 1).client_id, s.set_number);
    }
    store.setRpe(8);
    await store.endSession(client1, {
      saveChoice: "all",
      duration_min: 50,
    });
    expect(store.active?.pending_template_patch?.workout_id).toBe(42);

    // Retry with saveChoice=none: should clear without any network call.
    const { client: client2, fetchImpl: fetchImpl2 } = makeClient({});
    const second = await store.endSession(client2, {
      saveChoice: "none",
      duration_min: 50,
    });
    expect(second.status).toBe("submitted");
    expect(store.active).toBeNull();
    expect(fetchImpl2).not.toHaveBeenCalled();
  });
});
