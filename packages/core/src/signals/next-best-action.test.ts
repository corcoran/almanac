import { describe, expect, it } from "vitest";
import { createBodyWeight } from "../repos/body-weights.repo.js";
import { closeAndStartPhase } from "../repos/nutrition-phases.repo.js";
import { createSleepLog } from "../repos/sleep.repo.js";
import { createOrUpdateStepLog } from "../repos/step-logs.repo.js";
import { createUntrackedPeriod } from "../repos/untracked-periods.repo.js";
import { updateUser } from "../repos/users.repo.js";
import { createTemplate } from "../repos/workout-templates.repo.js";
import { freshDb, seedUser } from "../test-support/db.js";
import { computeDayStatus } from "./day-status.js";
import { computeNextBestAction } from "./next-best-action.js";

// A fixed "now": 2026-06-03 12:00 Toronto (EDT = UTC-4) → 16:00Z.
const NOW = new Date("2026-06-03T16:00:00Z");

function bareUser() {
  const db = freshDb();
  const userId = seedUser(db);
  updateUser(db, userId, {
    timezone: "America/Toronto",
    dob: null,
    height_cm: null,
    sex: null,
  });
  return { db, userId };
}

function completeProfile(db: ReturnType<typeof freshDb>, userId: number) {
  updateUser(db, userId, {
    dob: "1982-01-01",
    height_cm: 183,
    sex: "male",
    activity_level: "moderate",
  });
}

function startMaintenancePhase(db: ReturnType<typeof freshDb>, userId: number) {
  closeAndStartPhase(db, {
    user_id: userId,
    name: "maintenance",
    intent: "maintenance",
    phase_type: "maintenance",
    tdee_at_phase_start: 2400,
    tdee_source: "user_asserted",
    deficit_kcal: 0,
    daily_kcal_target: 2400,
    base_protein_g: 180,
    base_carb_g: 170,
    base_fat_g: 60,
    started_on: "2026-05-01",
  });
}

describe("computeNextBestAction — onboarding tier", () => {
  it("headlines complete_profile when profile fields are missing", () => {
    const { db, userId } = bareUser();
    const res = computeNextBestAction(db, userId, NOW);
    expect(res.onboarding_complete).toBe(false);
    expect(res.headline?.code).toBe("complete_profile");
    expect(res.headline?.tier).toBe("onboarding");
    expect(res.as_of).toBe("2026-06-03");
  });

  it("still headlines complete_profile when only activity_level is missing", () => {
    // activity_level is the largest cold-start TDEE lever (moderate 1.55 vs
    // active 1.725 is a ~300 kcal swing on a typical profile), but nothing
    // prompted for it before this. Null is NOT a safe skip — it silently
    // falls back to seedActivityMultiplier.
    const { db, userId } = bareUser();
    updateUser(db, userId, {
      dob: "1982-01-01",
      height_cm: 183,
      sex: "male",
      activity_level: null,
    });
    const res = computeNextBestAction(db, userId, NOW);
    expect(res.onboarding_complete).toBe(false);
    expect(res.headline?.code).toBe("complete_profile");
    expect(res.headline?.detail).toContain("activity level");
  });

  it("headlines log_initial_weight once profile is complete but no weight exists", () => {
    const { db, userId } = bareUser();
    completeProfile(db, userId);
    const res = computeNextBestAction(db, userId, NOW);
    expect(res.headline?.code).toBe("log_initial_weight");
  });

  it("headlines start_nutrition_phase once profile + weight exist, with maintenance hint", () => {
    const { db, userId } = bareUser();
    completeProfile(db, userId);
    createBodyWeight(db, { user_id: userId, weight_kg: 77, measured_on: "2026-06-01" });
    const res = computeNextBestAction(db, userId, NOW);
    expect(res.headline?.code).toBe("start_nutrition_phase");
    expect(res.headline?.suggested_args).toEqual({ phase_type: "maintenance" });
    expect(res.headline?.detail).toMatch(/provisional/i);
  });

  it("headlines create_workout_templates once profile + weight + phase exist", () => {
    const { db, userId } = bareUser();
    completeProfile(db, userId);
    createBodyWeight(db, { user_id: userId, weight_kg: 77, measured_on: "2026-06-01" });
    startMaintenancePhase(db, userId);
    const res = computeNextBestAction(db, userId, NOW);
    expect(res.headline?.code).toBe("create_workout_templates");
    expect(res.onboarding_complete).toBe(false);
  });
});

describe("computeNextBestAction — previous-day tier", () => {
  function onboardedUser() {
    const { db, userId } = bareUser();
    completeProfile(db, userId);
    createBodyWeight(db, { user_id: userId, weight_kg: 77, measured_on: "2026-06-01" });
    startMaintenancePhase(db, userId);
    createTemplate(db, { user_id: userId, name: "PUSH A", items: [] });
    return { db, userId };
  }

  it("headlines log_yesterday_sleep when yesterday has no sleep log", () => {
    const { db, userId } = onboardedUser();
    // Log yesterday's steps so only sleep is missing.
    createOrUpdateStepLog(db, { user_id: userId, on_date: "2026-06-02", steps: 8000 });
    const res = computeNextBestAction(db, userId, NOW);
    expect(res.onboarding_complete).toBe(true);
    expect(res.headline?.code).toBe("log_yesterday_sleep");
    expect(res.headline?.tier).toBe("previous_day");
    expect(res.headline?.suggested_args).toMatchObject({ slept_on: "2026-06-02" });
  });

  it("includes log_yesterday_steps when yesterday has no step log", () => {
    const { db, userId } = onboardedUser();
    // Log yesterday's sleep so only steps is missing.
    createSleepLog(db, { user_id: userId, slept_on: "2026-06-02", hours: 7.5, quality: 3 });
    const res = computeNextBestAction(db, userId, NOW);
    expect(res.headline?.code).toBe("log_yesterday_steps");
    expect(res.headline?.suggested_args).toMatchObject({ on_date: "2026-06-02" });
    expect(res.onboarding_complete).toBe(true);
  });

  it("returns all_clear when yesterday's sleep AND steps are both logged and no today nudges fire", () => {
    const { db, userId } = onboardedUser();
    createSleepLog(db, { user_id: userId, slept_on: "2026-06-02", hours: 7.5, quality: 3 });
    createOrUpdateStepLog(db, { user_id: userId, on_date: "2026-06-02", steps: 8000 });
    // (Tier 3 now active; today's fresh weight keeps stale_weight_log from firing.)
    createBodyWeight(db, { user_id: userId, weight_kg: 77, measured_on: "2026-06-03" });
    const res = computeNextBestAction(db, userId, NOW);
    expect(res.all_clear).toBe(true);
    expect(res.headline).toBeNull();
  });
});

describe("untracked-day suppression of yesterday backfill", () => {
  const NOW = new Date("2026-05-21T18:00:00Z"); // today=2026-05-21, yesterday=2026-05-20

  // Mirrors `onboardedUser` from the previous-day tier suite: complete profile,
  // a body weight, an active maintenance phase, and a workout template — i.e.
  // all Tier-1 gates pass. No yesterday sleep/step logs, so yesterday is empty.
  function seedFullyOnboarded(db: ReturnType<typeof freshDb>): number {
    const userId = seedUser(db);
    updateUser(db, userId, {
      timezone: "America/Toronto",
      dob: null,
      height_cm: null,
      sex: null,
    });
    completeProfile(db, userId);
    createBodyWeight(db, { user_id: userId, weight_kg: 77, measured_on: "2026-06-01" });
    startMaintenancePhase(db, userId);
    createTemplate(db, { user_id: userId, name: "PUSH A", items: [] });
    return userId;
  }

  it("does not nag to backfill yesterday's sleep/steps when yesterday is untracked", () => {
    const db = freshDb();
    const userId = seedFullyOnboarded(db);
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-18",
      ended_on: "2026-05-21",
      reason: "vacation",
    });
    const r = computeNextBestAction(db, userId, NOW);
    expect(r.actions.find((a) => a.code === "log_yesterday_sleep")).toBeUndefined();
    expect(r.actions.find((a) => a.code === "log_yesterday_steps")).toBeUndefined();
  });

  it("still nags when yesterday is NOT untracked", () => {
    const db = freshDb();
    const userId = seedFullyOnboarded(db);
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-01",
      ended_on: "2026-05-05",
      reason: "vacation",
    });
    const r = computeNextBestAction(db, userId, NOW);
    expect(r.actions.find((a) => a.code === "log_yesterday_sleep")).toBeDefined();
    expect(r.actions.find((a) => a.code === "log_yesterday_steps")).toBeDefined();
  });
});

describe("computeNextBestAction — today tier (delegated)", () => {
  function onboardedNoPrevGaps() {
    const { db, userId } = bareUser();
    completeProfile(db, userId);
    // Stale weigh-in: 2026-05-20 is 14 days before NOW; default
    // noWeightMaxDays=3 and concern threshold >9 → fires stale_weight_log
    // at severity "concern" in computeDayStatus.
    createBodyWeight(db, { user_id: userId, weight_kg: 77, measured_on: "2026-05-20" });
    startMaintenancePhase(db, userId);
    createTemplate(db, { user_id: userId, name: "PUSH A", items: [] });
    // Fill yesterday so Tier 2 stays silent.
    createSleepLog(db, { user_id: userId, slept_on: "2026-06-02", hours: 7.5, quality: 3 });
    createOrUpdateStepLog(db, { user_id: userId, on_date: "2026-06-02", steps: 8000 });
    return { db, userId };
  }

  it("surfaces a warn/concern day-status nudge as a today-tier action", () => {
    const { db, userId } = onboardedNoPrevGaps();
    // Sanity: confirm day-status actually emits stale_weight_log for this fixture.
    const ds = computeDayStatus(db, userId, NOW);
    expect(ds.nudges.some((n) => n.code === "stale_weight_log")).toBe(true);

    const res = computeNextBestAction(db, userId, NOW);
    expect(res.all_clear).toBe(false);
    expect(res.headline?.tier).toBe("today");
    expect(res.headline?.code).toBe("stale_weight_log");
    expect(res.headline?.detail.length).toBeGreaterThan(0);
    expect(res.headline?.severity).toBe("concern");
    expect(res.headline?.details).toBeDefined();
  });

  it("does NOT surface info-only nudges as actions", () => {
    const { db, userId } = bareUser();
    completeProfile(db, userId);
    createBodyWeight(db, { user_id: userId, weight_kg: 77, measured_on: "2026-06-03" });
    startMaintenancePhase(db, userId);
    createTemplate(db, { user_id: userId, name: "PUSH A", items: [] });
    createSleepLog(db, { user_id: userId, slept_on: "2026-06-02", hours: 7.5, quality: 3 });
    createOrUpdateStepLog(db, { user_id: userId, on_date: "2026-06-02", steps: 8000 });
    const res = computeNextBestAction(db, userId, NOW);
    expect(res.all_clear).toBe(true);
    expect(res.headline).toBeNull();
  });
});
