import { defined } from "@almanac/core/test-support";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/workouts", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  function setup() {
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    // user
    a.db
      .prepare(
        "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('Jeff', '1990-01-01', 180, 'male', 'test@example.com')",
      )
      .run();
    // (nutrition_phase isn't required by workouts but the project's canonical
    //  seed includes it, so requests that exercise getCurrentUserId have a
    //  fully-set-up environment matching meals.test.ts.)
    a.db
      .prepare(
        `INSERT INTO nutrition_phases
        (user_id, name, intent, phase_type, tdee_at_phase_start, tdee_source, deficit_kcal,
         daily_kcal_target, base_protein_g, base_carb_g, base_fat_g, started_on)
       VALUES (1, 'cut', 'cut', 'cut', 2400, 'user_asserted', -500, 1900, 180, 170, 60, '2026-05-01')`,
      )
      .run();
    // exercise_groups
    a.db
      .prepare("INSERT INTO exercise_groups (user_id, name, display_order) VALUES (1, 'Push', 0)")
      .run();
    // exercises
    a.db.prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (1, 1, 'Bench')").run();
    a.db.prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (1, 1, 'OHP')").run();
    a.db
      .prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (1, 1, 'Triceps Pushdown')")
      .run();
    // template: items = [Bench @3x10, OHP @3x8]
    a.db.prepare("INSERT INTO workout_templates (user_id, name) VALUES (1, 'Push Day')").run();
    a.db
      .prepare(
        `INSERT INTO workout_template_items
        (template_id, exercise_id, display_order, default_sets, default_reps, default_weight_kg)
       VALUES (1, 1, 1, 3, 10, 60)`,
      )
      .run();
    a.db
      .prepare(
        `INSERT INTO workout_template_items
        (template_id, exercise_id, display_order, default_sets, default_reps, default_weight_kg)
       VALUES (1, 2, 2, 3, 8, 30)`,
      )
      .run();
    return a;
  }
  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  // ------- POST: full-shape ---------------------------------------------

  it("POST full-shape creates workout + nested exercise_instances + sets, returns 201", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-05-12T18:00:00Z",
        duration_min: 60,
        rpe: 8,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 3,
            sets: [
              { reps: 10, weight_kg: 60 },
              { reps: 10, weight_kg: 60 },
              { reps: 8, weight_kg: 60 },
            ],
          },
          {
            exercise_id: 2,
            display_order: 2,
            planned_sets: 3,
            sets: [
              { reps: 8, weight_kg: 30 },
              { reps: 8, weight_kg: 30 },
              { reps: 6, weight_kg: 30 },
            ],
          },
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.user_id).toBe(1);
    expect(body.template_id).toBeNull();
    expect(body.rpe).toBe(8);
    expect(body.exercises.length).toBe(2);
    expect(body.exercises[0].sets.length).toBe(3);
    expect(body.exercises[0].sets[0].id).toBeGreaterThan(0);
    expect(body.exercises[0].sets[0].reps).toBe(10);
    expect(body.exercises[0].sets[0].weight_kg).toBe(60);
    expect(body.exercises[0].sets[2].reps).toBe(8);
  });

  it("POST compact-set form expands { count, reps, weight_kg } to N sets", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-05-12T18:00:00Z",
        rpe: 7,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 3,
            sets: { count: 3, reps: 12, weight_kg: 20 },
          },
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.exercises[0].sets.length).toBe(3);
    expect(body.exercises[0].sets[0].reps).toBe(12);
    expect(body.exercises[0].sets[0].weight_kg).toBe(20);
    expect(body.exercises[0].sets[2].weight_kg).toBe(20);
  });

  // ------- POST: from-template ------------------------------------------

  it("POST from-template with skip + override_sets + add resolves and returns 201", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        template_id: 1,
        started_at: "2026-05-12T18:00:00Z",
        rpe: 8,
        deviations: [
          { op: "skip", exercise_id: 1 }, // skip Bench
          {
            op: "override_sets",
            exercise_id: 2,
            sets: [
              { reps: 6, weight_kg: 35 },
              { reps: 6, weight_kg: 35 },
            ],
            planned_sets: 2,
          },
          {
            op: "add",
            exercise_id: 3,
            planned_sets: 3,
            sets: { count: 3, reps: 12, weight_kg: 15 },
          },
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.template_id).toBe(1);
    // After skip(1), override(2), add(3): we expect 3 exercises in resolved order.
    // Bench (skipped — persisted with sets=[] and skipped_at set),
    // OHP (override at template display_order=2),
    // Triceps Pushdown (auto-assigned order=3).
    expect(body.exercises.length).toBe(3);
    expect(body.exercises[0].exercise_id).toBe(1);
    expect(body.exercises[0].sets).toEqual([]);
    // skipped_at must equal the workout's started_at (not log-time), so retro-
    // logged workouts don't lie about when the skip happened.
    expect(body.exercises[0].skipped_at).toBe(body.started_at);
    expect(body.exercises[1].exercise_id).toBe(2);
    expect(body.exercises[1].sets.length).toBe(2);
    expect(body.exercises[1].sets[0].reps).toBe(6);
    expect(body.exercises[1].sets[0].weight_kg).toBe(35);
    expect(body.exercises[1].skipped_at).toBeNull();
    expect(body.exercises[2].exercise_id).toBe(3);
    expect(body.exercises[2].sets.length).toBe(3);
    expect(body.exercises[2].sets[0].reps).toBe(12);
    expect(body.exercises[2].skipped_at).toBeNull();
  });

  it("POST /api/v1/workouts with template_id and no deviations resolves to the template as written", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        template_id: 1,
        started_at: "2026-05-12T18:00:00Z",
        rpe: 7,
        // no `deviations`, no `exercises` — should be treated as deviations: []
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.template_id).toBe(1);
    // Template items: [Bench @3x10@60, OHP @3x8@30]. With no deviations, the
    // resolved exercises should mirror the template defaults exactly.
    expect(body.exercises.length).toBe(2);
    expect(body.exercises[0].exercise_id).toBe(1);
    expect(body.exercises[0].planned_sets).toBe(3);
    expect(body.exercises[0].sets.length).toBe(3);
    expect(body.exercises[0].sets[0].reps).toBe(10);
    expect(body.exercises[0].sets[0].weight_kg).toBe(60);
    expect(body.exercises[0].skipped_at).toBeNull();
    expect(body.exercises[1].exercise_id).toBe(2);
    expect(body.exercises[1].planned_sets).toBe(3);
    expect(body.exercises[1].sets.length).toBe(3);
    expect(body.exercises[1].sets[0].reps).toBe(8);
    expect(body.exercises[1].sets[0].weight_kg).toBe(30);
    expect(body.exercises[1].skipped_at).toBeNull();
  });

  it("POST from-template: skip of non-template exercise -> 422", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        template_id: 1,
        started_at: "2026-05-12T18:00:00Z",
        rpe: 7,
        deviations: [{ op: "skip", exercise_id: 3 }], // 3 not in template
      },
    });
    expect(r.statusCode).toBe(422);
    const body = r.json();
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toMatch(/not in template/i);
  });

  it("POST from-template: override of non-template exercise -> 422", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        template_id: 1,
        started_at: "2026-05-12T18:00:00Z",
        rpe: 7,
        deviations: [
          {
            op: "override_sets",
            exercise_id: 3, // not in template
            sets: [{ reps: 10, weight_kg: 10 }],
            planned_sets: 1,
          },
        ],
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("validation_failed");
    expect(r.json().error.message).toMatch(/not in template/i);
  });

  it("POST from-template: add of an existing template exercise -> 422", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        template_id: 1,
        started_at: "2026-05-12T18:00:00Z",
        rpe: 7,
        deviations: [
          {
            op: "add",
            exercise_id: 1, // already in template
            planned_sets: 3,
            sets: { count: 3, reps: 10, weight_kg: 60 },
          },
        ],
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("validation_failed");
    expect(r.json().error.message).toMatch(/already in template/i);
  });

  it("POST: 422 on missing required fields (no rpe)", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-05-12T18:00:00Z",
        // rpe missing
        exercises: [],
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("validation_failed");
  });

  // ------- GET ----------------------------------------------------------

  it("GET /api/v1/workouts/:id returns the full tree", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-05-12T18:00:00Z",
        rpe: 7,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 2,
            sets: [
              { reps: 10, weight_kg: 50 },
              { reps: 9, weight_kg: 50 },
            ],
          },
        ],
      },
    });
    const id = c.json().id;
    const r = await app.inject({ method: "GET", url: `/api/v1/workouts/${id}`, headers: auth });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.id).toBe(id);
    expect(body.exercises.length).toBe(1);
    expect(body.exercises[0].sets.length).toBe(2);
    expect(body.exercises[0].sets[1].reps).toBe(9);
  });

  it("GET /api/v1/workouts/:id 404 when missing", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/workouts/999", headers: auth });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("not_found");
  });

  it("GET /api/v1/workouts filters by from/to range", async () => {
    app = setup();
    // Earlier workout (excluded by from)
    await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-04-01T10:00:00Z",
        rpe: 7,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 5, weight_kg: 40 }],
          },
        ],
      },
    });
    // In-range workout
    await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-05-12T18:00:00Z",
        rpe: 8,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 5, weight_kg: 60 }],
          },
        ],
      },
    });
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/workouts?from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.length).toBe(1);
    expect(body[0].started_at.startsWith("2026-05-12")).toBe(true);
  });

  // ------- PATCH workout ------------------------------------------------

  it("PATCH /api/v1/workouts/:id updates fields", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-05-12T18:00:00Z",
        rpe: 7,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 5, weight_kg: 60 }],
          },
        ],
      },
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/workouts/${id}`,
      headers: auth,
      payload: { rpe: 9, notes: "tougher than expected" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().rpe).toBe(9);
    expect(r.json().notes).toBe("tougher than expected");
  });

  it("PATCH /api/v1/workouts/:id 404 when missing", async () => {
    app = setup();
    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/workouts/999",
      headers: auth,
      payload: { rpe: 6 },
    });
    expect(r.statusCode).toBe(404);
  });

  // ------- DELETE workout (cascade) -------------------------------------

  it("DELETE /api/v1/workouts/:id returns 204 and cascades to exercise_instances + sets", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-05-12T18:00:00Z",
        rpe: 7,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 2,
            sets: [
              { reps: 10, weight_kg: 50 },
              { reps: 9, weight_kg: 50 },
            ],
          },
        ],
      },
    });
    const body = c.json();
    const workoutId = body.id;
    const eiId = body.exercises[0].id;
    const setId = body.exercises[0].sets[0].id;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/workouts/${workoutId}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);

    // Workout gone
    const get = await app.inject({
      method: "GET",
      url: `/api/v1/workouts/${workoutId}`,
      headers: auth,
    });
    expect(get.statusCode).toBe(404);

    // Exercise instance + set gone via ON DELETE CASCADE
    const eiRow = defined(app, "app")
      .db.prepare("SELECT id FROM exercise_instances WHERE id = ?")
      .get(eiId);
    expect(eiRow).toBeUndefined();
    const setRow = defined(app, "app").db.prepare("SELECT id FROM sets WHERE id = ?").get(setId);
    expect(setRow).toBeUndefined();
  });

  // ------- POST /:id/exercise-instances ---------------------------------

  it("POST /api/v1/workouts/:id/exercise-instances appends an instance with sets", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-05-12T18:00:00Z",
        rpe: 7,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: 60 }],
          },
        ],
      },
    });
    const workoutId = c.json().id;
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/workouts/${workoutId}/exercise-instances`,
      headers: auth,
      payload: {
        exercise_id: 3,
        display_order: 2,
        planned_sets: 3,
        sets: { count: 3, reps: 12, weight_kg: 15 },
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.workout_id).toBe(workoutId);
    expect(body.exercise_id).toBe(3);
    expect(body.sets.length).toBe(3);
    expect(body.sets[0].reps).toBe(12);
  });

  // ------- PATCH/DELETE sets --------------------------------------------

  it("PATCH /api/v1/sets/:id updates fields", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-05-12T18:00:00Z",
        rpe: 7,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: 60 }],
          },
        ],
      },
    });
    const setId = c.json().exercises[0].sets[0].id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/sets/${setId}`,
      headers: auth,
      payload: { reps: 12, weight_kg: 62.5 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().reps).toBe(12);
    expect(r.json().weight_kg).toBe(62.5);
  });

  it("DELETE /api/v1/sets/:id returns 204", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-05-12T18:00:00Z",
        rpe: 7,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 2,
            sets: [
              { reps: 10, weight_kg: 60 },
              { reps: 9, weight_kg: 60 },
            ],
          },
        ],
      },
    });
    const setId = c.json().exercises[0].sets[1].id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/sets/${setId}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    const row = defined(app, "app").db.prepare("SELECT id FROM sets WHERE id = ?").get(setId);
    expect(row).toBeUndefined();
  });

  // ------- POST: naked-local timestamp normalization -------------------

  it("PATCH normalizes naked local started_at against the user's timezone", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-05-12T18:00:00Z",
        rpe: 7,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: 60 }],
          },
        ],
      },
    });
    const id = c.json().id;
    // 2026-05-08 16:20 in Toronto (EDT, UTC-4) == 2026-05-08T20:20:00Z.
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/workouts/${id}`,
      headers: auth,
      payload: { started_at: "2026-05-08T16:20:00" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().started_at).toBe("2026-05-08T20:20:00.000Z");
  });

  it("POST: naked local started_at is interpreted in the user's profile timezone", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    // 2026-05-08 16:20 in Toronto (EDT, UTC-4) == 2026-05-08T20:20:00Z.
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: "2026-05-08T16:20:00",
        rpe: 7,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 1,
            sets: [{ reps: 10, weight_kg: 60 }],
          },
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().started_at).toBe("2026-05-08T20:20:00.000Z");
  });

  // ------- GET /v1/workouts/by-date ----------------------------------------

  it("GET /v1/workouts/by-date returns the day's workouts WITH exercise detail", async () => {
    app = setup();
    const today = new Date().toISOString().slice(0, 10);
    await app.inject({
      method: "POST",
      url: "/api/v1/workouts",
      headers: auth,
      payload: {
        started_at: `${today}T15:00:00Z`,
        rpe: 8,
        exercises: [
          {
            exercise_id: 1,
            display_order: 1,
            planned_sets: 3,
            sets: [
              { reps: 5, weight_kg: 60 },
              { reps: 5, weight_kg: 60 },
            ],
          },
        ],
      },
    });
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/workouts/by-date?date=${today}`,
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].exercises.length).toBeGreaterThan(0);
    expect(body[0].exercises[0].sets.length).toBeGreaterThan(0);
  });

  it("GET /v1/workouts/by-date returns [] for a day with no workouts", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/workouts/by-date?date=2020-01-01",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
  });
});
