import { currentUserDate, userDayWindow } from "@almanac/core/types";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

/**
 * Smoke tests for GET /api/v1/calendar?month=YYYY-MM. Compute correctness
 * lives in @almanac/core/signals/calendar-pills.test.ts; here we only
 * verify the route plumbs DB → signal-function → response shape, and
 * that the bearer-token guard fires.
 *
 * Seed shape: a fresh user (timezone defaults to "UTC" via migrations).
 * No nutrition_phase needed — the route never calls findActivePhase.
 */
describe("/api/v1/calendar", () => {
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
    return a;
  }
  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  it("GET /api/v1/calendar returns a valid empty response when no workouts exist", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?month=2026-05",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.month).toBe("2026-05");
    expect(body.tally.total).toBe(0);
    expect(body.tally.by_template).toEqual({});
    expect(body.past_sessions).toEqual([]);
    expect(body.pill_segments).toEqual([]);
  });

  it("GET /api/v1/calendar for a past month populates past_sessions and leaves pill_segments empty", async () => {
    app = setup();
    // Seed a template + an exercise + a workout in Jan 2026 (well in the past
    // relative to the system clock when this test runs). The detrained cutoff
    // is 14 days, so pills can't possibly extend into the queried month.
    app.db
      .prepare("INSERT INTO exercise_groups (user_id, name, display_order) VALUES (1, 'Push', 0)")
      .run();
    app.db.prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (1, 1, 'Bench')").run();
    app.db.prepare("INSERT INTO workout_templates (user_id, name) VALUES (1, 'PUSH A')").run();
    app.db
      .prepare(
        `INSERT INTO workouts (user_id, template_id, started_at, rpe, est_kcal)
         VALUES (1, 1, '2026-01-15T18:00:00Z', 8, 300)`,
      )
      .run();

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?month=2026-01",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.month).toBe("2026-01");
    expect(body.tally.total).toBe(1);
    expect(body.tally.by_template["PUSH A"]).toBe(1);
    expect(body.past_sessions).toHaveLength(1);
    expect(body.past_sessions[0].date).toBe("2026-01-15");
    expect(body.past_sessions[0].template_id).toBe(1);
    expect(body.past_sessions[0].template_name).toBe("PUSH A");
    // Past month: pill_segments must be empty (pills only extend forward
    // from the most recent hit into days >= today; a Jan 2026 hit, viewed
    // when "today" is current, can't reach back into Jan 2026).
    expect(body.pill_segments).toEqual([]);
  });

  it("GET /api/v1/calendar for the current month populates past_sessions AND pill_segments", async () => {
    app = setup();
    app.db
      .prepare("INSERT INTO exercise_groups (user_id, name, display_order) VALUES (1, 'Push', 0)")
      .run();
    app.db.prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (1, 1, 'Bench')").run();
    app.db.prepare("INSERT INTO workout_templates (user_id, name) VALUES (1, 'PUSH A')").run();
    // A recent workout that anchors a pill extending forward into the rest of
    // its month. Getting this right against a live wall clock has three traps,
    // all from the route bucketing user-*local* days (4am DAY_START_HOUR), not
    // raw UTC:
    //
    //   1. Day bucketing. The route buckets each workout via `currentUserDate`
    //      and computes "today" the same way. A naive 00:30-UTC stamp buckets
    //      to the PREVIOUS user-local day, so between 00:00–03:59 UTC the hit
    //      (and its month) silently shift back a day. We derive BOTH the stamp
    //      and the queried `month` from the same user-local date to stay
    //      self-consistent at every UTC hour.
    //
    //   2. Freshness. The pill's Q9b guard drops any template whose phase, as
    //      of `now`, is already fading/detrained (>14 days). The hit must be
    //      recent — a few days old, not weeks.
    //
    //   3. Forward-walk room. The pill walks days AFTER the workout and only
    //      emits segments landing in the queried month. Anchor on (or within a
    //      day of) month-end and every forward day spills into next month →
    //      zero segments.
    //
    // We satisfy all three by anchoring the workout WITHIN today's user-local
    // month: aim for 3 days ago (fresh, with forward days ahead of it), but
    // clamp to at least the 1st of this month so it never slips into the prior
    // month. When "today" itself is in the first days of the month the workout
    // lands on the 1st — still ≤3 days old (fresh) with same-month days ahead.
    const now = new Date();
    const todayLocal = currentUserDate(now, "UTC");
    const monthStr = todayLocal.slice(0, 7);
    const targetDay = Math.max(1, Number(todayLocal.slice(8, 10)) - 3);
    const workoutDate = `${monthStr}-${String(targetDay).padStart(2, "0")}`;
    const month = monthStr;
    const startedAt = userDayWindow(workoutDate, "UTC").startUtc;
    app.db
      .prepare(
        `INSERT INTO workouts (user_id, template_id, started_at, rpe, est_kcal)
         VALUES (1, 1, ?, 8, 300)`,
      )
      .run(startedAt.toISOString());

    const r = await app.inject({
      method: "GET",
      url: `/api/v1/calendar?month=${month}`,
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.month).toBe(month);
    expect(body.tally.total).toBe(1);
    expect(body.past_sessions).toHaveLength(1);
    expect(body.pill_segments.length).toBeGreaterThanOrEqual(1);
    const pill = body.pill_segments[0];
    expect(pill.template_id).toBe(1);
    expect(pill.template_name).toBe("PUSH A");
    expect(Array.isArray(pill.segments)).toBe(true);
    expect(pill.segments.length).toBeGreaterThanOrEqual(1);
    for (const seg of pill.segments) {
      expect(["too_soon", "acceptable", "prime", "in_window"]).toContain(seg.phase);
    }
  });

  it("includes a west-of-UTC user's last-local-day evening workout whose started_at rolls into the next UTC month", async () => {
    // Regression: a workout done on the evening of the month's LAST local day
    // (America/Toronto, UTC-4) has a started_at that rolls into the NEXT UTC
    // day — e.g. 20:35 EDT June 30 == 2026-07-01T00:35Z. The route's fetch
    // upper bound was `${nextMonth}-01T00:00:00Z` (UTC midnight, no padding),
    // so this June-local workout sorted just past it and was dropped from the
    // June calendar — invisible even on a hard reload. It wasn't on July
    // either, since the signal buckets it to user-local 2026-06-30.
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    a.db
      .prepare(
        "INSERT INTO users (name, dob, height_cm, sex, email, timezone) VALUES ('Jeff', '1990-01-01', 180, 'male', 'test@example.com', 'America/Toronto')",
      )
      .run();
    app = a;
    app.db
      .prepare("INSERT INTO exercise_groups (user_id, name, display_order) VALUES (1, 'Pull', 0)")
      .run();
    app.db.prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (1, 1, 'Row')").run();
    app.db.prepare("INSERT INTO workout_templates (user_id, name) VALUES (1, 'PULL')").run();
    app.db
      .prepare(
        `INSERT INTO workouts (user_id, template_id, started_at, rpe, est_kcal)
         VALUES (1, 1, '2026-07-01T00:35:11.000Z', 8, 300)`,
      )
      .run();

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?month=2026-06",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.past_sessions).toHaveLength(1);
    expect(body.past_sessions[0].date).toBe("2026-06-30");
    expect(body.past_sessions[0].template_name).toBe("PULL");
    expect(body.tally.total).toBe(1);
  });

  it("GET /api/v1/calendar rejects malformed month", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?month=2026-5",
      headers: auth,
    });
    expect(r.statusCode).toBe(422);
  });

  it("GET /api/v1/calendar rejects month=2026-00 (out-of-range month)", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?month=2026-00",
      headers: auth,
    });
    expect(r.statusCode).toBe(422);
  });

  it("GET /api/v1/calendar rejects month=2026-13 (out-of-range month)", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?month=2026-13",
      headers: auth,
    });
    expect(r.statusCode).toBe(422);
  });

  it("GET /api/v1/calendar returns 401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/calendar?month=2026-05" });
    expect(r.statusCode).toBe(401);
  });
});
