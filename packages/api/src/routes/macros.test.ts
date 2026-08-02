import { createUntrackedPeriod } from "@almanac/core/repos";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

/**
 * Tests for GET /api/v1/signals/macros — three query modes:
 *   - ?date=YYYY-MM-DD               → single user-day totals + target
 *   - ?from_date=...&to_date=...     → array of per-day totals + targets
 *   - ?at=ISO                        → the user-day containing the instant
 *
 * Day aggregation must use the user-TZ window, not UTC date(eaten_at).
 */
describe("/api/v1/signals/macros", () => {
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

  it("?date= returns single-day shape {date, day_totals, day_target}", async () => {
    app = setup();
    // Seed two meals on 2026-05-08 in the user-day window (UTC, default tz).
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
       VALUES (1, '2026-05-08T08:00:00Z', 400, 30, 50, 10),
              (1, '2026-05-08T18:00:00Z', 600, 50, 40, 20)`,
      )
      .run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?date=2026-05-08",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.date).toBe("2026-05-08");
    expect(body.day_totals).toEqual({
      kcal: 1000,
      protein_g: 80,
      carb_g: 90,
      fat_g: 30,
      // No alcohol logged for this day → 100% from food.
      kcal_from_food: 1000,
      kcal_from_alcohol: 0,
    });
    // New TDEE-refactor shape: target/maintenance/intake/observed.
    expect(body.day_target.target).toEqual({
      kcal: 1900,
      protein_g: 180,
      carb_g: 170,
      fat_g: 60,
    });
    expect(body.day_target.maintenance).toEqual({ kcal: 2400 });
    expect(body.day_target.intake.kcal).toBe(1000);
    expect(body.day_target.observed.status).toMatch(/^(on_track|at_risk|off_track)$/);
    // Critically: NOT wrapped in {days: [...]}.
    expect(body.days).toBeUndefined();
  });

  it("?date= includes alcohol kcal in day_totals.kcal", async () => {
    app = setup();
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
       VALUES (1, '2026-05-08T08:00:00Z', 400, 30, 50, 10)`,
      )
      .run();
    app.db
      .prepare(
        `INSERT INTO alcohol_sessions (user_id, started_at, drinks_count, est_kcal)
       VALUES (1, '2026-05-08T20:00:00Z', 2, 250)`,
      )
      .run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?date=2026-05-08",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.day_totals.kcal).toBe(650);
    expect(body.day_totals.protein_g).toBe(30); // alcohol doesn't add protein/carb/fat
    // Breakdown should split the kcal back out by source.
    expect(body.day_totals.kcal_from_food).toBe(400);
    expect(body.day_totals.kcal_from_alcohol).toBe(250);
  });

  it("?from_date=&to_date= returns {days: [...]} with one entry per date", async () => {
    app = setup();
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
       VALUES (1, '2026-05-08T08:00:00Z', 400, 30, 50, 10),
              (1, '2026-05-09T08:00:00Z', 500, 40, 60, 15),
              (1, '2026-05-10T08:00:00Z', 600, 50, 70, 20)`,
      )
      .run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?from_date=2026-05-08&to_date=2026-05-10",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.days).toBeDefined();
    expect(body.days.length).toBe(3);
    expect(body.days.map((d: { date: string }) => d.date)).toEqual([
      "2026-05-08",
      "2026-05-09",
      "2026-05-10",
    ]);
    expect(body.days[0].day_totals.kcal).toBe(400);
    expect(body.days[1].day_totals.kcal).toBe(500);
    expect(body.days[2].day_totals.kcal).toBe(600);
  });

  it("flags untracked days in the range response", async () => {
    app = setup();
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
       VALUES (1, '2026-05-10T08:00:00Z', 400, 30, 50, 10),
              (1, '2026-05-11T08:00:00Z', 500, 40, 60, 15),
              (1, '2026-05-12T08:00:00Z', 600, 50, 70, 20)`,
      )
      .run();
    createUntrackedPeriod(app.db, {
      user_id: 1,
      started_on: "2026-05-11",
      ended_on: "2026-05-11",
      reason: "vacation",
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?from_date=2026-05-10&to_date=2026-05-12",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const find = (d: string) => body.days.find((x: { date: string }) => x.date === d);
    expect(find("2026-05-11").untracked).toBe(true);
    expect(find("2026-05-10").untracked).toBe(false);
  });

  it("range > 90 days returns 400 validation_failed", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?from_date=2026-01-01&to_date=2026-05-01",
      headers: auth,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("validation_failed");
  });

  it("range with to_date < from_date returns 400", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?from_date=2026-05-10&to_date=2026-05-08",
      headers: auth,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("validation_failed");
  });

  it("?at= resolves to the user-day in the user's timezone (Toronto 02:00 → previous day)", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    // 2026-05-09T06:00:00Z = 02:00 EDT on May 9 → before 04:00 rollover → user-day May 8.
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
       VALUES (1, '2026-05-09T01:00:00Z', 300, 20, 40, 10)`,
      )
      .run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?at=2026-05-09T06:00:00Z",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.date).toBe("2026-05-08");
    // The meal at 21:00 EDT on May 8 (2026-05-09T01:00:00Z) should be in this user-day.
    expect(body.day_totals.kcal).toBe(300);
  });

  it("?date= respects user TZ window — late-night meal falls into prior user-day", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    // 2026-05-09T01:00:00Z = 21:00 EDT May 8 → inside May 8 user-day.
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
       VALUES (1, '2026-05-09T01:00:00Z', 300, 20, 40, 10)`,
      )
      .run();
    // 2026-05-09T10:00:00Z = 06:00 EDT May 9 → inside May 9 user-day.
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
       VALUES (1, '2026-05-09T10:00:00Z', 500, 35, 60, 15)`,
      )
      .run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?date=2026-05-08",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().day_totals.kcal).toBe(300);
  });

  it("surfaces workout + cardio kcal under day_target.observed (new shape)", async () => {
    app = setup();
    app.db
      .prepare(
        `INSERT INTO workouts (user_id, template_id, started_at, rpe, est_kcal)
       VALUES (1, NULL, '2026-05-08T12:00:00Z', 7, 300)`,
      )
      .run();
    app.db
      .prepare(
        `INSERT INTO cardio_sessions (user_id, started_at, est_kcal)
       VALUES (1, '2026-05-08T17:00:00Z', 200)`,
      )
      .run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?date=2026-05-08",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    // Activity is exposed under `observed` (cardio_kcal + workout_kcal).
    expect(body.day_target.observed.cardio_kcal).toBe(200);
    expect(body.day_target.observed.workout_kcal).toBe(300);
    // Static target is unaffected by today's activity — that's the whole
    // point of the refactor.
    expect(body.day_target.target.kcal).toBe(1900);
    expect(body.day_target.maintenance.kcal).toBe(2400);
    // effective_kcal is gone.
    expect(body.day_target.effective_kcal).toBeUndefined();
  });

  it("returns 200 with day_target: null when no active nutrition phase exists", async () => {
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    a.db
      .prepare(
        "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('Jeff', '1990-01-01', 180, 'male', 'test@example.com')",
      )
      .run();
    app = a;
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?date=2026-05-08",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.date).toBe("2026-05-08");
    expect(body.day_target).toBeNull();
    expect(body.day_totals.kcal).toBe(0);
  });

  it("422 when no query params supplied", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros",
      headers: auth,
    });
    expect(r.statusCode).toBe(422);
  });

  it("401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/signals/macros?date=2026-05-08" });
    expect(r.statusCode).toBe(401);
  });

  it("?date= returns net_kcal from daily_net snapshot when present", async () => {
    app = setup();
    // Seed a meal so the day has intake data.
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
       VALUES (1, '2026-05-08T08:00:00Z', 1900, 140, 160, 55)`,
      )
      .run();
    // Seed the daily_net snapshot directly.
    app.db
      .prepare(
        `INSERT INTO daily_net (user_id, on_date, net_kcal, intake_kcal, tdee_used, tdee_basis)
       VALUES (1, '2026-05-08', -470, 1900, 2370, 'measured_intake')`,
      )
      .run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?date=2026-05-08",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.net_kcal).toBe(-470);
  });

  it("?date= returns net_kcal: null when no daily_net row exists for that date", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?date=2026-05-07",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.net_kcal).toBeNull();
  });

  it("range response includes net_kcal per day (populated or null)", async () => {
    app = setup();
    app.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
       VALUES (1, '2026-05-08T08:00:00Z', 1900, 140, 160, 55),
              (1, '2026-05-09T08:00:00Z', 2000, 145, 165, 58)`,
      )
      .run();
    // Only seed daily_net for May 8, not May 9.
    app.db
      .prepare(
        `INSERT INTO daily_net (user_id, on_date, net_kcal, intake_kcal, tdee_used, tdee_basis)
       VALUES (1, '2026-05-08', -470, 1900, 2370, 'measured_intake')`,
      )
      .run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/macros?from_date=2026-05-08&to_date=2026-05-09",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    const d08 = body.days.find((d: { date: string }) => d.date === "2026-05-08");
    const d09 = body.days.find((d: { date: string }) => d.date === "2026-05-09");
    expect(d08.net_kcal).toBe(-470);
    expect(d09.net_kcal).toBeNull();
  });
});
