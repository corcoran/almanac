import type { Connection } from "@almanac/core/db";
import {
  closeAndStartPhase,
  createMeal,
  createUntrackedPeriod,
  updateUser,
} from "@almanac/core/repos";
import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import { computePhaseAdherence } from "./phase-adherence.js";

const TZ = "America/Toronto";

function setupCutPhase(startedOn = "2026-05-01") {
  const db = freshDb();
  const userId = seedUser(db);
  updateUser(db, userId, { timezone: TZ });
  closeAndStartPhase(db, {
    user_id: userId,
    name: "cut",
    intent: "cut",
    phase_type: "cut",
    tdee_at_phase_start: 2400,
    tdee_source: "user_asserted",
    deficit_kcal: -500,
    daily_kcal_target: 1900,
    base_protein_g: 180,
    base_carb_g: 170,
    base_fat_g: 60,
    started_on: startedOn,
  });
  return { db, userId };
}

// One meal at 16:00 UTC = noon ET, safely inside the Toronto user-day for `date`.
function mealOn(db: Connection, userId: number, date: string, kcal: number) {
  createMeal(db, {
    user_id: userId,
    eaten_at: `${date}T16:00:00Z`,
    kcal,
    protein_g: 150,
    carb_g: 150,
    fat_g: 50,
  });
}

describe("computePhaseAdherence", () => {
  it("counts logged on-target days into X and logged days into N", () => {
    const { db, userId } = setupCutPhase("2026-05-01");
    // 3 on-target days (1800 < 1900 target), 1 over-maintenance day (2600 > 2400).
    mealOn(db, userId, "2026-05-01", 1800);
    mealOn(db, userId, "2026-05-02", 1800);
    mealOn(db, userId, "2026-05-03", 1800);
    mealOn(db, userId, "2026-05-04", 2600);
    const result = computePhaseAdherence(
      db,
      userId,
      TZ,
      { started_on: "2026-05-01", tdee_at_phase_start: 2400 },
      "2026-05-04",
    );
    expect(result.logged_days).toBe(4);
    expect(result.on_track_days).toBe(3);
  });

  it("skips untracked days — not in N, not a miss", () => {
    const { db, userId } = setupCutPhase("2026-05-01");
    mealOn(db, userId, "2026-05-01", 1800); // on target
    mealOn(db, userId, "2026-05-02", 1800); // on target, but untracked → skipped
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-02",
      ended_on: "2026-05-02",
      reason: "vacation",
    });
    const result = computePhaseAdherence(
      db,
      userId,
      TZ,
      { started_on: "2026-05-01", tdee_at_phase_start: 2400 },
      "2026-05-02",
    );
    expect(result.logged_days).toBe(1);
    expect(result.on_track_days).toBe(1);
  });

  it("skips no-meal days — not in N", () => {
    const { db, userId } = setupCutPhase("2026-05-01");
    mealOn(db, userId, "2026-05-01", 1800);
    // 2026-05-02 has no meal logged.
    const result = computePhaseAdherence(
      db,
      userId,
      TZ,
      { started_on: "2026-05-01", tdee_at_phase_start: 2400 },
      "2026-05-02",
    );
    expect(result.logged_days).toBe(1);
    expect(result.on_track_days).toBe(1);
  });

  it("averages (intake − anchor) over logged days, rounded", () => {
    const { db, userId } = setupCutPhase("2026-05-01");
    // deltas vs 2400 anchor: -600, -400 → mean -500.
    mealOn(db, userId, "2026-05-01", 1800);
    mealOn(db, userId, "2026-05-02", 2000);
    const result = computePhaseAdherence(
      db,
      userId,
      TZ,
      { started_on: "2026-05-01", tdee_at_phase_start: 2400 },
      "2026-05-02",
    );
    expect(result.avg_delta_kcal).toBe(-500);
  });

  it("returns null avg when there are no logged days", () => {
    const { db, userId } = setupCutPhase("2026-05-01");
    const result = computePhaseAdherence(
      db,
      userId,
      TZ,
      { started_on: "2026-05-01", tdee_at_phase_start: 2400 },
      "2026-05-01",
    );
    expect(result.logged_days).toBe(0);
    expect(result.on_track_days).toBe(0);
    expect(result.avg_delta_kcal).toBeNull();
  });

  it("returns the count but null avg when there is no TDEE anchor", () => {
    const { db, userId } = setupCutPhase("2026-05-01");
    mealOn(db, userId, "2026-05-01", 1800);
    const result = computePhaseAdherence(
      db,
      userId,
      TZ,
      { started_on: "2026-05-01", tdee_at_phase_start: null },
      "2026-05-01",
    );
    expect(result.logged_days).toBe(1);
    expect(result.on_track_days).toBe(1);
    expect(result.avg_delta_kcal).toBeNull();
  });
});
