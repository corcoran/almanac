import { getDailyNetRange } from "@almanac/core/repos";
import { computeTdeeAsOf } from "@almanac/core/signals";
import { defined } from "@almanac/core/test-support";
import { addDaysIso } from "@almanac/core/types";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

/**
 * END-TO-END integration test for "snapshotted NET".
 *
 * NET(user-local day D) = intake(D) − computedTDEE(asOf D−1), persisted in
 * `daily_net` and kept current by the meal write-path. EVERY other test of this
 * feature STUBS the TDEE function, so the real `computeTdeeAsOf` back-calc and
 * the D−1 offset have no coverage. This test drives the REAL pipeline through
 * the meals API and pins the numbers against direct `computeTdeeAsOf` calls.
 *
 * Determinism: a FIXED dataset, no `Date.now()` / `new Date()` with no args
 * (computeTDEE forbids them). Timezone is 'UTC' and all event timestamps are at
 * noon, so user-local-day bucketing is trivial (DAY_START_HOUR edges are covered
 * elsewhere) — a meal at YYYY-MM-DDT12:00:00Z lands on user-day YYYY-MM-DD.
 *
 * For the back-calc (basis "measured_intake") to engage, computeTDEE needs:
 *   - bodyWeights.length >= fallbackWindowDays (14), AND
 *   - daysWithData (logged meal-days in the trailing window) >= minMealDaysForBackcalc (7).
 * We seed ~29 daily weigh-ins (2026-05-10 .. 2026-06-07) and a daily pre-week
 * meal (2026-05-10 .. 2026-05-31) so every test-week day's asOf=D−1 window has
 * >=14 weigh-ins and >=7 meal-days.
 */
describe("daily-net snapshot pipeline (real TDEE, end-to-end)", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };
  const userId = 1;
  const tz = "UTC";

  const weekStart = "2026-06-01";
  const weekEnd = "2026-06-07";
  // Known daily kcal per test-week day, varied so each day's net differs.
  const weekKcal: Record<string, number> = {
    "2026-06-01": 1900,
    "2026-06-02": 2100,
    "2026-06-03": 1800,
    "2026-06-04": 2400,
    "2026-06-05": 2000,
    "2026-06-06": 1750,
    "2026-06-07": 2200,
  };

  /**
   * Seed all PRE-WEEK context directly (weights + pre-week meals). The test-week
   * meals are driven through the API so the write-path snapshots fire with the
   * REAL computeTdeeAsOf.
   */
  function setup(): FastifyInstance {
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    a.db
      .prepare(
        "INSERT INTO users (name, dob, height_cm, sex, email, timezone) VALUES ('Jeff', '1990-01-01', 180, 'male', 'test@example.com', 'UTC')",
      )
      .run();
    // Active nutrition phase so day_target (and the macros read path) is non-null.
    a.db
      .prepare(
        `INSERT INTO nutrition_phases
          (user_id, name, intent, phase_type, tdee_at_phase_start, tdee_source, deficit_kcal,
           daily_kcal_target, base_protein_g, base_carb_g, base_fat_g, started_on)
         VALUES (1, 'cut', 'cut', 'cut', 2400, 'user_asserted', -500, 1900, 180, 170, 60, '2026-05-01')`,
      )
      .run();

    // Daily body weights 2026-05-10 .. 2026-06-07 (29 days), gentle linear
    // DOWNWARD trend: 80.00 kg → ~79.16 kg, -0.03 kg/day. Steep enough that the
    // trend-weight delta (and thus TDEE) drifts a few kcal day-to-day, so the
    // D−1-vs-D offset assertion (d) has teeth; small enough that TDEE stays
    // realistic and the back-calc never floors at BMR.
    const wInsert = a.db.prepare(
      "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (?, ?, ?)",
    );
    let day = "2026-05-10";
    let kg = 80.0;
    while (day <= "2026-06-07") {
      wInsert.run(userId, day, Number(kg.toFixed(2)));
      day = addDaysIso(day, 1);
      kg -= 0.03;
    }

    // Pre-week meals: one 2000 kcal meal/day 2026-05-10 .. 2026-05-31 so the
    // trailing window for every test-week day has >=7 meal-days (measured basis).
    const mInsert = a.db.prepare(
      "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (?, ?, ?, 150, 200, 60)",
    );
    let pre = "2026-05-10";
    while (pre <= "2026-05-31") {
      mInsert.run(userId, `${pre}T12:00:00Z`, 2000);
      pre = addDaysIso(pre, 1);
    }
    return a;
  }

  const mealPayload = (eaten_at: string, kcal: number) => ({
    eaten_at,
    kcal,
    protein_g: 25,
    carb_g: 30,
    fat_g: 15,
  });

  /** POST the full test week through the API, triggering the real snapshots. */
  async function postTestWeek(a: FastifyInstance): Promise<void> {
    for (const [date, kcal] of Object.entries(weekKcal)) {
      const r = await a.inject({
        method: "POST",
        url: "/api/v1/meals",
        headers: auth,
        payload: mealPayload(`${date}T12:00:00Z`, kcal),
      });
      expect(r.statusCode).toBe(201);
    }
  }

  it("snapshots the whole week using the real measured-intake back-calc", async () => {
    app = setup();
    await postTestWeek(app);

    const dayRows = getDailyNetRange(app.db, userId, weekStart, weekEnd);
    expect(dayRows.length).toBe(7);
    // Dataset must be rich enough that the back-calc engages for every day.
    // If this fails, the dataset lacks weigh-ins/meal-days — do NOT weaken it.
    expect(dayRows.every((r) => r.tdee_basis === "measured_intake")).toBe(true);

    // Pin one day's TDEE EXACTLY against a direct computeTdeeAsOf for asOf D−1.
    const someDay = "2026-06-04";
    const direct = computeTdeeAsOf(app.db, userId, addDaysIso(someDay, -1), tz);
    const snap = dayRows.find((r) => r.on_date === someDay) ?? null;
    expect(snap).not.toBeNull();
    expect(snap?.tdee_used).toBe(direct.kcal);
  });

  it("each day's net == intake − tdee_used (snapshot is self-consistent)", async () => {
    app = setup();
    await postTestWeek(app);
    const dayRows = getDailyNetRange(app.db, userId, weekStart, weekEnd);
    expect(dayRows.length).toBe(7);
    for (const r of dayRows) {
      expect(r.net_kcal).toBe(r.intake_kcal - r.tdee_used);
      // intake matches the known daily kcal we POSTed.
      expect(r.intake_kcal).toBe(defined(weekKcal[r.on_date], `weekKcal[${r.on_date}]`));
    }
  });

  it("the macros read path surfaces the same net the snapshots hold", async () => {
    app = setup();
    await postTestWeek(app);
    const dayRows = getDailyNetRange(app.db, userId, weekStart, weekEnd);
    const range = await app
      .inject({
        method: "GET",
        url: `/api/v1/signals/macros?from_date=${weekStart}&to_date=${weekEnd}`,
        headers: auth,
      })
      .then((x) => x.json());
    expect(range.days.length).toBe(7);
    for (const day of range.days) {
      const r = dayRows.find((x) => x.on_date === day.date) ?? null;
      expect(day.net_kcal).toBe(r?.net_kcal ?? null);
    }
  });

  it("D−1 offset is load-bearing: tdee_used == computeTdeeAsOf(D−1), NOT (D)", async () => {
    const a = setup();
    app = a;
    await postTestWeek(a);
    const dayRows = getDailyNetRange(a.db, userId, weekStart, weekEnd);

    // The downward weight trend makes TDEE drift day-to-day, so for a mid-week
    // day computeTdeeAsOf(D−1) and computeTdeeAsOf(D) differ. Find such a day so
    // the offset is genuinely distinguishable (not pinned only by cross-check).
    const distinguishing = dayRows.find((r) => {
      const dMinus1 = computeTdeeAsOf(a.db, userId, addDaysIso(r.on_date, -1), tz).kcal;
      const dItself = computeTdeeAsOf(a.db, userId, r.on_date, tz).kcal;
      return dMinus1 !== dItself;
    });
    // If the trend ever flattens TDEE so D−1 === D for ALL days, this assertion
    // can't distinguish the offset on its own — the exact-match cross-check in
    // the first test still pins it. We expect a distinguishing day to exist.
    expect(distinguishing).not.toBeUndefined();
    if (distinguishing) {
      const dMinus1 = computeTdeeAsOf(
        a.db,
        userId,
        addDaysIso(distinguishing.on_date, -1),
        tz,
      ).kcal;
      const dItself = computeTdeeAsOf(a.db, userId, distinguishing.on_date, tz).kcal;
      expect(distinguishing.tdee_used).toBe(dMinus1);
      expect(distinguishing.tdee_used).not.toBe(dItself);
    }
  });

  it("a day with zero meals has no snapshot and net_kcal: null in the range", async () => {
    app = setup();
    // POST every test-week day EXCEPT 2026-06-03 (leave it mealless).
    for (const [date, kcal] of Object.entries(weekKcal)) {
      if (date === "2026-06-03") continue;
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/meals",
        headers: auth,
        payload: mealPayload(`${date}T12:00:00Z`, kcal),
      });
      expect(r.statusCode).toBe(201);
    }
    const dayRows = getDailyNetRange(app.db, userId, weekStart, weekEnd);
    expect(dayRows.length).toBe(6);
    expect(dayRows.find((r) => r.on_date === "2026-06-03")).toBeUndefined();

    const range = await app
      .inject({
        method: "GET",
        url: `/api/v1/signals/macros?from_date=${weekStart}&to_date=${weekEnd}`,
        headers: auth,
      })
      .then((x) => x.json());
    const mealless = range.days.find((d: { date: string }) => d.date === "2026-06-03") ?? null;
    expect(mealless).not.toBeNull();
    expect(mealless?.net_kcal).toBeNull();
  });

  it("idempotent re-POST (same Idempotency-Key) leaves the day's net unchanged", async () => {
    app = setup();
    const date = "2026-06-02";
    const idemHeaders = { ...auth, "idempotency-key": "fixed-key-2026-06-02" };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/meals",
      headers: idemHeaders,
      payload: mealPayload(`${date}T12:00:00Z`, weekKcal[date] ?? 0),
    });
    expect(first.statusCode).toBe(201);
    const before = defined(
      getDailyNetRange(app.db, userId, date, date).find((r) => r.on_date === date),
      "net row after first POST",
    );

    // Replay the identical request — idempotency replays the stored response,
    // creates no second meal, and must not move the net.
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/meals",
      headers: idemHeaders,
      payload: mealPayload(`${date}T12:00:00Z`, weekKcal[date] ?? 0),
    });
    expect(second.headers["idempotency-replayed"]).toBe("true");

    const after = defined(
      getDailyNetRange(app.db, userId, date, date).find((r) => r.on_date === date),
      "net row after replayed POST",
    );
    expect(after.net_kcal).toBe(before.net_kcal);
    expect(after.intake_kcal).toBe(before.intake_kcal);
    // Exactly one meal exists for the day (replay did not duplicate).
    const meals = await app
      .inject({
        method: "GET",
        url: `/api/v1/meals?from_date=${date}&to_date=${date}`,
        headers: auth,
      })
      .then((x) => x.json());
    expect(meals.length).toBe(1);
  });

  it("PATCH editing a meal's kcal moves only that day's net by the exact delta", async () => {
    app = setup();
    await postTestWeek(app);
    const editDate = "2026-06-04";
    const otherDate = "2026-06-05";

    const before = getDailyNetRange(app.db, userId, weekStart, weekEnd);
    const beforeEdit = defined(
      before.find((r) => r.on_date === editDate),
      "edit-day net before PATCH",
    );
    const beforeOther = defined(
      before.find((r) => r.on_date === otherDate),
      "other-day net before PATCH",
    );

    // Find the meal on editDate and bump its kcal by a known delta.
    const meals = await app
      .inject({
        method: "GET",
        url: `/api/v1/meals?from_date=${editDate}&to_date=${editDate}`,
        headers: auth,
      })
      .then((x) => x.json());
    expect(meals.length).toBe(1);
    const mealId = defined(meals[0], "the single meal on editDate").id;
    const delta = 300;
    const newKcal = (weekKcal[editDate] ?? 0) + delta;
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/meals/${mealId}`,
      headers: auth,
      payload: { kcal: newKcal },
    });
    expect(patch.statusCode).toBe(200);

    const after = getDailyNetRange(app.db, userId, weekStart, weekEnd);
    const afterEdit = defined(
      after.find((r) => r.on_date === editDate),
      "edit-day net after PATCH",
    );
    const afterOther = defined(
      after.find((r) => r.on_date === otherDate),
      "other-day net after PATCH",
    );

    // The edited day's intake AND net move by exactly the kcal delta (tdee_used
    // is asOf D−1, unaffected by same-day intake), and tdee_used is unchanged.
    expect(afterEdit.intake_kcal).toBe(beforeEdit.intake_kcal + delta);
    expect(afterEdit.net_kcal).toBe(beforeEdit.net_kcal + delta);
    expect(afterEdit.tdee_used).toBe(beforeEdit.tdee_used);
    // An untouched day is completely unchanged.
    expect(afterOther.net_kcal).toBe(beforeOther.net_kcal);
    expect(afterOther.intake_kcal).toBe(beforeOther.intake_kcal);
  });
});
