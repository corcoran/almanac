import { addDaysIso, currentUserDate } from "@almanac/core/types";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

/**
 * Smoke tests for the /api/v1/signals/* read-only routes. Signal-function
 * correctness lives in @almanac/core/signals/*.test.ts; here we only verify
 * each route plumbs DB → signal-function → response shape, and that
 * /alcohol-overlay enforces workout_id correctly.
 *
 * Seed shape: each test gets a fresh user + active nutrition_phase. Most
 * tests add the minimum extra rows their endpoint needs.
 */
describe("/api/v1/signals", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  function setup() {
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    a.db
      .prepare(
        "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('Jeff', '1990-01-01', 180, 'male', 'test@example.com')",
      )
      .run();
    a.db
      .prepare(
        `INSERT INTO nutrition_phases
        (user_id, name, intent, phase_type, tdee_at_phase_start, tdee_source, deficit_kcal,
         daily_kcal_target, base_protein_g, base_carb_g, base_fat_g, started_on)
       VALUES (1, 'cut', 'cut', 'cut', 2400, 'user_asserted', -500, 1900, 180, 170, 60, '2026-05-01')`,
      )
      .run();
    return a;
  }
  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };
  // The server buckets events to the user-local day (4am DAY_START_HOUR), so a raw
  // UTC `slice(0,10)` mis-attributes "today" during the 00:00–04:00 UTC window —
  // compute it the same way the signal does (cf. sleep/accomplishments tests).
  const today = currentUserDate(new Date(), "UTC");

  it("GET /api/v1/signals/today returns full context (phase + stim_states + new TDEE shape)", async () => {
    app = setup();
    // exercise group + exercise so stim_states has something to iterate.
    app.db
      .prepare("INSERT INTO exercise_groups (user_id, name, display_order) VALUES (1, 'Push', 0)")
      .run();
    app.db.prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (1, 1, 'Bench')").run();
    const r = await app.inject({ method: "GET", url: "/api/v1/signals/today", headers: auth });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.phase.name).toBe("cut");
    expect(body.phase.phase_type).toBe("cut");
    expect(body.phase.tdee_at_phase_start).toBe(2400);
    expect(body.phase.deficit_kcal).toBe(-500);
    expect(body.stim_states.length).toBeGreaterThanOrEqual(1);
    // New TDEE-refactor shape: static target + maintenance + observed.
    expect(body.today.target.kcal).toBe(1900);
    expect(body.today.target.protein_g).toBe(180);
    expect(body.today.maintenance.kcal).toBe(2400);
    expect(body.today.observed.status).toMatch(/^(on_track|at_risk|off_track)$/);
    expect(body.today.intake).toBeDefined();
    expect(body.profile_complete).toBe(false); // no weight logged in setup()
  });

  it("GET /api/v1/signals/today populates phase_adherence when phase has a logged meal today", async () => {
    // Regression guard: phase_adherence must be present and non-null when there
    // is an active phase with ≥1 meal logged on a non-untracked day. The field
    // lives in core; this test locks in the route serialisation contract.
    app = setup();
    // Seed an on-track meal for today (1800 kcal < cut target 1900, well within
    // the 10%-of-TDEE grace window). UTC noon ensures it lands in today's
    // user-day window regardless of DST (user timezone defaults to UTC).
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
         VALUES (1, ?, 1800, 180, 150, 60)`,
      )
      .run(`${today}T12:00:00Z`);
    const r = await app.inject({ method: "GET", url: "/api/v1/signals/today", headers: auth });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      phase_adherence: {
        logged_days: number;
        on_track_days: number;
        avg_delta_kcal: number | null;
      } | null;
    };
    expect(body.phase_adherence).not.toBeNull();
    // At least today's logged day counts.
    expect(body.phase_adherence?.logged_days).toBeGreaterThanOrEqual(1);
    expect(body.phase_adherence?.on_track_days).toBeGreaterThanOrEqual(0);
    expect(body.phase_adherence).toHaveProperty("avg_delta_kcal");
  });

  it("GET /api/v1/signals/today returns success with null phase fields when no active phase", async () => {
    // No-phase branch: must return 200 with phase/target/maintenance/observed
    // all null. intake and the phase-independent fields still populate.
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    a.db
      .prepare(
        "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('Jeff', '1990-01-01', 180, 'male', 'test@example.com')",
      )
      .run();
    app = a;
    const r = await app.inject({ method: "GET", url: "/api/v1/signals/today", headers: auth });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.phase).toBeNull();
    expect(body.today.target).toBeNull();
    expect(body.today.maintenance).toBeNull();
    expect(body.today.observed).toBeNull();
    expect(body.today.intake).toEqual({ kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 });
    expect(body.profile_complete).toBe(false);
    // TDEE is non-nullable — falls back to profile_baseline. Source surfaces.
    expect(body.tdee).toBeDefined();
    expect(body.tdee.source).toBe("formula");
  });

  it("GET /api/v1/signals/stim-states returns one state per group", async () => {
    app = setup();
    app.db
      .prepare("INSERT INTO exercise_groups (user_id, name, display_order) VALUES (1, 'Push', 0)")
      .run();
    app.db
      .prepare("INSERT INTO exercise_groups (user_id, name, display_order) VALUES (1, 'Pull', 1)")
      .run();
    app.db.prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (1, 1, 'Bench')").run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/stim-states",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].group_name).toBe("Push");
  });

  it("GET /api/v1/signals/tdee returns profile_baseline / early with <14 days of weights", async () => {
    app = setup();
    app.db
      .prepare("INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, 82.0)")
      .run(today);
    const r = await app.inject({ method: "GET", url: "/api/v1/signals/tdee", headers: auth });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.basis).toBe("profile_baseline");
    expect(body.confidence).toBe("early");
    expect(body.kcal).toBeGreaterThan(0);
  });

  it("GET /api/v1/signals/tdee excludes untracked days from the back-calc", async () => {
    // Regression: the route previously passed `untrackedDays: new Set()`, so a
    // vacation's inflated meals leaked into avg_kcal_in. Seed enough weight +
    // meal history to flip to measured_intake, place 3 inflated meal-days inside
    // a marked untracked period, and assert they don't drag the average up.
    const a = setup();
    app = a;
    const iso = (offset: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    // 16 days of weights → days_of_data clears the 14-day fallback gate.
    for (let i = 16; i >= 1; i--) {
      a.db
        .prepare("INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, ?)")
        .run(iso(-i), 80 - i * 0.02);
    }
    const meal = (offset: number, kcal: number) =>
      a.db
        .prepare(
          "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, ?, ?, 150, 200, 70)",
        )
        .run(`${iso(offset)}T13:00:00Z`, kcal);
    // 7 tracked meal-days at ~2000 kcal (clears minMealDaysForBackcalc).
    for (const off of [-13, -12, -11, -10, -9, -8, -7]) meal(off, 2000);
    // 3 inflated meal-days INSIDE the untracked window (must be excluded).
    for (const off of [-5, -4, -3]) meal(off, 6000);
    // Mark days -6..-2 as a vacation that covers the inflated days.
    a.db
      .prepare(
        "INSERT INTO untracked_periods (user_id, started_on, ended_on, reason) VALUES (1, ?, ?, 'vacation')",
      )
      .run(iso(-6), iso(-2));

    const r = await app.inject({ method: "GET", url: "/api/v1/signals/tdee", headers: auth });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.basis).toBe("measured_intake");
    // 7 tracked days at 2000; the 6000-kcal vacation days are excluded.
    expect(body.components.avg_kcal_in.value).toBeCloseTo(2000, 0);
    expect(body.components.avg_kcal_in.days_with_data).toBe(7);
    expect(body.components.untracked_days_in_window).toBeGreaterThan(0);
  });

  it("GET /api/v1/signals/trend-weight returns one point per reading", async () => {
    app = setup();
    app.db
      .prepare(
        "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, '2026-05-10', 80.0)",
      )
      .run();
    app.db
      .prepare(
        "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, '2026-05-11', 80.4)",
      )
      .run();
    app.db
      .prepare(
        "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, '2026-05-12', 80.2)",
      )
      .run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/trend-weight",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.length).toBe(3);
    expect(typeof body[0].trend_kg).toBe("number");
  });

  it("GET /api/v1/signals/sleep-debt counts logged nights in window", async () => {
    app = setup();
    // Seed 3 nights within the default 7-day window ending today.
    const d = (n: number) => {
      const x = new Date(`${today}T00:00:00Z`);
      x.setUTCDate(x.getUTCDate() - n);
      return x.toISOString().slice(0, 10);
    };
    app.db
      .prepare("INSERT INTO sleep_logs (user_id, slept_on, hours, quality) VALUES (1, ?, 7.5, 4)")
      .run(d(0));
    app.db
      .prepare("INSERT INTO sleep_logs (user_id, slept_on, hours, quality) VALUES (1, ?, 6.0, 3)")
      .run(d(1));
    app.db
      .prepare("INSERT INTO sleep_logs (user_id, slept_on, hours, quality) VALUES (1, ?, 8.0, 5)")
      .run(d(2));
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/sleep-debt",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.nights_logged).toBe(3);
    expect(body.window_days).toBe(7);
    expect(body.debt_hours).toBeGreaterThan(0);
  });

  it("GET /api/v1/signals/alcohol-overlay aggregates drinks in 48h before workout", async () => {
    app = setup();
    // Workout at noon today; alcohol session 4 hours before → peak zone.
    const workoutAt = `${today}T12:00:00Z`;
    const drinkAt = new Date(Date.parse(workoutAt) - 4 * 3600 * 1000).toISOString();
    app.db
      .prepare(
        `INSERT INTO workouts (user_id, template_id, started_at, rpe, est_kcal)
       VALUES (1, NULL, ?, 7, 300)`,
      )
      .run(workoutAt);
    app.db
      .prepare(
        `INSERT INTO alcohol_sessions (user_id, started_at, drinks_count, est_kcal)
       VALUES (1, ?, 2, 200)`,
      )
      .run(drinkAt);
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/alcohol-overlay?workout_id=1",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.workout_id).toBe(1);
    expect(body.drinks_peak_mps_zone).toBeGreaterThanOrEqual(1);
    expect(body.total_drinks_in_window).toBe(2);
  });

  it("GET /api/v1/signals/alcohol-overlay returns 404 for unknown workout_id", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/alcohol-overlay?workout_id=999",
      headers: auth,
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("not_found");
  });

  it("GET /api/v1/signals/daily-target returns the new {target, maintenance, intake, observed} block", async () => {
    app = setup();
    // No activity, no intake yet → status 'off_track' is fine for a cut at
    // 0 kcal intake (intake < target ≤ maintenance, but the test only
    // verifies the shape, not the status semantics).
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/signals/daily-target?date=${today}`,
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    // Static target from phase.daily_kcal_target (1900) / base_*_g.
    expect(body.target).toEqual({ kcal: 1900, protein_g: 180, carb_g: 170, fat_g: 60 });
    // Maintenance = phase.tdee_at_phase_start (2400).
    expect(body.maintenance).toEqual({ kcal: 2400 });
    // No meals today.
    expect(body.intake.kcal).toBe(0);
    // Observed shape — activity breakdown + verdict.
    expect(body.observed.cardio_kcal).toBe(0);
    expect(body.observed.workout_kcal).toBe(0);
    expect(body.observed.status).toMatch(/^(on_track|at_risk|off_track)$/);
    // No `effective_kcal`, no `base_kcal` in the new shape.
    expect(body.effective_kcal).toBeUndefined();
    expect(body.base_kcal).toBeUndefined();
  });

  it("GET /api/v1/signals/day-kcal-in sums meals + alcohol on the date", async () => {
    app = setup();
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
       VALUES (1, ?, 400, 30, 50, 10)`,
      )
      .run(`${today}T08:00:00Z`);
    app.db
      .prepare(
        `INSERT INTO alcohol_sessions (user_id, started_at, drinks_count, est_kcal)
       VALUES (1, ?, 1, 150)`,
      )
      .run(`${today}T20:00:00Z`);
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/signals/day-kcal-in?date=${today}`,
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.date).toBe(today);
    expect(body.kcal).toBe(550);
  });

  it("GET /api/v1/signals/day-kcal-in attributes an evening meal to its user-local day", async () => {
    app = setup();
    // America/New_York user (UTC-4 in May). A 9pm-ET meal on 2026-05-20 is
    // 2026-05-21T01:00:00Z — still inside the 2026-05-20 user-day window
    // (04:00 ET → 04:00 ET next day). Naive UTC date() bucketing would
    // mis-attribute it to 2026-05-21 and exclude it from 05-20.
    app.db.prepare("UPDATE users SET timezone = 'America/New_York' WHERE id = 1").run();
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
       VALUES (1, ?, 700, 50, 60, 20)`,
      )
      .run("2026-05-21T01:00:00Z");
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/day-kcal-in?date=2026-05-20",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.date).toBe("2026-05-20");
    expect(body.kcal).toBe(700);
  });

  it("GET /api/v1/signals/recommend-template returns ranked templates (Gap 24)", async () => {
    app = setup();
    // Two groups, two exercises, two templates. PUSH hits group 1; PULL hits group 2.
    // With no prior workouts, both groups are 'detrained' → score 0 each.
    app.db
      .prepare("INSERT INTO exercise_groups (user_id, name, display_order) VALUES (1, 'Push', 0)")
      .run();
    app.db
      .prepare("INSERT INTO exercise_groups (user_id, name, display_order) VALUES (1, 'Pull', 1)")
      .run();
    app.db.prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (1, 1, 'Bench')").run();
    app.db.prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (1, 2, 'Row')").run();
    app.db.prepare("INSERT INTO workout_templates (user_id, name) VALUES (1, 'PUSH')").run();
    app.db.prepare("INSERT INTO workout_templates (user_id, name) VALUES (1, 'PULL')").run();
    app.db
      .prepare(
        `INSERT INTO workout_template_items (template_id, exercise_id, display_order, default_sets, default_reps)
         VALUES (1, 1, 0, 3, 10), (2, 2, 0, 3, 10)`,
      )
      .run();

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/recommend-template?top_n=2",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.recommendations).toHaveLength(2);
    const names = body.recommendations.map((x: { template_name: string }) => x.template_name);
    expect(names).toContain("PUSH");
    expect(names).toContain("PULL");
    // Degenerate case: both groups detrained → score 0, no real signal. The
    // confidence flag + overdue bucket must survive route serialization (they
    // are required by RecommendTemplateResponseSchema, so a missing field would
    // 500). This locks in the wire shape end-to-end, not just in the unit test.
    for (const rec of body.recommendations as Array<{
      score: number;
      confidence: string;
      reasoning: { overdue_groups_hit: string[] };
    }>) {
      expect(rec.score).toBe(0);
      expect(rec.confidence).toBe("low");
      expect(rec.reasoning.overdue_groups_hit).toHaveLength(1);
    }
  });

  it("recommend-template returns empty list when no templates defined", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/recommend-template",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().recommendations).toEqual([]);
  });

  it("GET /api/v1/signals/today?date= returns that day's context", async () => {
    app = setup();
    const yesterday = addDaysIso(today, -1);
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
         VALUES (1, ?, 1700, 150, 150, 50)`,
      )
      .run(`${yesterday}T12:00:00Z`);
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/signals/today?date=${yesterday}`,
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.today_date).toBe(yesterday);
    expect(body.today.intake.kcal).toBe(1700);
  });

  it("GET /api/v1/signals/today?date= does NOT count a meal from a different day", async () => {
    app = setup();
    const yesterday = addDaysIso(today, -1);
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
         VALUES (1, ?, 1700, 150, 150, 50)`,
      )
      .run(`${today}T12:00:00Z`);
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/signals/today?date=${yesterday}`,
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().today.intake.kcal).toBe(0);
  });

  it("GET /api/v1/signals/today rejects a future date with 400", async () => {
    app = setup();
    const tomorrow = addDaysIso(today, 1);
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/signals/today?date=${tomorrow}`,
      headers: auth,
    });
    expect(r.statusCode).toBe(400);
  });

  it("GET /api/v1/signals/today with no date returns today (unchanged)", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/signals/today", headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().today_date).toBe(today);
  });

  it("401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/signals/today" });
    expect(r.statusCode).toBe(401);
  });

  it("GET /api/v1/signals/training-history returns a summary", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/training-history?days=14",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.sessions).toBe(0); // fresh user, no workouts
    expect(body.by_split).toEqual([]);
    expect(body.window_days).toBe(14);
  });

  it("GET /api/v1/signals/day-status returns summary + nudges shape", async () => {
    // Smoke-test the API surface — the underlying signal has exhaustive
    // unit coverage in core; here we just verify the route is wired up and
    // the schema validates the response.
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/day-status",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.summary).toBeDefined();
    expect(body.summary.kcal_target).toBe(1900);
    expect(typeof body.summary.workout_done).toBe("boolean");
    expect(body.summary.energy_balance).toBeDefined();
    // Status field is present and computed from active phase.
    expect(body.summary.status).toBe("on_track");
    expect(Array.isArray(body.nudges)).toBe(true);
    // Fresh user with no logs — expect the two "never logged" nudges.
    const codes = body.nudges.map((n: { code: string }) => n.code);
    expect(codes).toContain("stale_weight_log");
    expect(codes).toContain("stale_sleep_log");
  });
});
