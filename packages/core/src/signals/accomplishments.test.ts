import type { Connection } from "@almanac/core/db";
import {
  closeAndStartPhase,
  createBodyWeight,
  createCardioSession,
  createExercise,
  createGroup,
  createMeal,
  createSleepLog,
  createUntrackedPeriod,
  createWorkout,
  insertAccomplishment,
  listRecentAccomplishments,
  updateUser,
} from "@almanac/core/repos";
import {
  AccomplishmentCodeSchema,
  type AccomplishmentsResponse,
  AccomplishmentsResponseSchema,
} from "@almanac/core/schemas";
import { WEIGHT_VALUE_CODES } from "@almanac/core/types";
import { describe, expect, it } from "vitest";
import { addDaysIso } from "../domain/user-day.js";
import { freshDb, seedUser } from "../test-support/db.js";
import {
  computeAccomplishmentAggregates,
  detectAccomplishments,
  getAccomplishmentHistory,
  getRecentAccomplishments,
  persistNewAccomplishments,
} from "./accomplishments.js";

function setup(tz = "America/Toronto") {
  const db = freshDb();
  const userId = seedUser(db);
  updateUser(db, userId, { timezone: tz });
  return { db, userId };
}

/**
 * Seed enough weigh-ins + meals (14 consecutive days ending 2026-05-21) to flip
 * computeTDEE's `basis` to `measured_intake`. Mirrors the known-good seeding in
 * tdee.test.ts ("switches to measured_intake once fallbackWindowDays exist"):
 * 14 days of weights with a slight downward trend + 14 days of 2200-kcal meals.
 */
function seedMeasuredTdee(db: Connection, userId: number): void {
  for (let i = 0; i < 14; i++) {
    const d = `2026-05-${String(8 + i).padStart(2, "0")}`;
    createBodyWeight(db, { user_id: userId, measured_on: d, weight_kg: 80 - i * 0.05 });
    createMeal(db, {
      user_id: userId,
      // Noon UTC sits safely inside the Toronto user-day for that calendar date.
      eaten_at: `${d}T16:00:00Z`,
      kcal: 2200,
      protein_g: 150,
      carb_g: 200,
      fat_g: 70,
    });
  }
}

describe("detectAccomplishments — weigh_in_streak", () => {
  it("emits the 7-day milestone when exactly 7 consecutive user-local days have a weigh-in", () => {
    const { db, userId } = setup();
    // 7 consecutive days ending 2026-05-21
    for (let i = 0; i < 7; i++) {
      const d = `2026-05-${String(15 + i).padStart(2, "0")}`;
      createBodyWeight(db, { user_id: userId, measured_on: d, weight_kg: 82 });
    }
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    const streak = wins.filter((w) => w.code === "weigh_in_streak");
    expect(streak.map((w) => w.value)).toEqual([7]);
    expect(streak[0]?.earned_on).toBe("2026-05-21");
  });

  it("emits both 7 and 14 milestones when the streak is at 14", () => {
    const { db, userId } = setup();
    for (let i = 0; i < 14; i++) {
      const d = `2026-05-${String(8 + i).padStart(2, "0")}`;
      createBodyWeight(db, { user_id: userId, measured_on: d, weight_kg: 82 });
    }
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    const vals = wins
      .filter((w) => w.code === "weigh_in_streak")
      .map((w) => w.value)
      .sort((a, b) => a - b);
    expect(vals).toEqual([7, 14]);
  });

  it("does not emit when the streak has a gap (only 6 in a row)", () => {
    const { db, userId } = setup();
    for (let i = 0; i < 6; i++) {
      const d = `2026-05-${String(16 + i).padStart(2, "0")}`;
      createBodyWeight(db, { user_id: userId, measured_on: d, weight_kg: 82 });
    }
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    expect(wins.filter((w) => w.code === "weigh_in_streak")).toEqual([]);
  });
});

describe("detectAccomplishments — tdee_measured", () => {
  it("emits once when TDEE basis is measured_intake", () => {
    const { db, userId } = setup();
    seedMeasuredTdee(db, userId); // 14 days ending 2026-05-21
    // 'now' is the day AFTER the last seeded day, so the live TDEE window (which
    // ends on today − 1) covers all 14 COMPLETED days and flips to measured.
    const wins = detectAccomplishments(db, userId, new Date("2026-05-22T20:00:00Z"));
    expect(wins.filter((w) => w.code === "tdee_measured").map((w) => w.value)).toEqual([0]);
  });

  it("does not emit while basis is profile_baseline", () => {
    const { db, userId } = setup();
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    expect(wins.filter((w) => w.code === "tdee_measured")).toEqual([]);
  });
});

function setupWithCutPhase(tz = "America/Toronto") {
  const db = freshDb();
  const userId = seedUser(db);
  updateUser(db, userId, { timezone: tz });
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
    started_on: "2026-05-01",
  });
  return { db, userId };
}

/**
 * Seed `count` consecutive user-local days starting at `startDate` with a single
 * on-target meal each (1800 kcal — under the 1900 cut target, well inside grace).
 * 16:00 UTC noon-ET keeps each meal inside its Toronto user-day.
 */
function seedOnTrackDays(db: Connection, userId: number, startDate: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const d = addDaysIso(startDate, i);
    createMeal(db, {
      user_id: userId,
      eaten_at: `${d}T16:00:00Z`,
      kcal: 1800,
      protein_g: 180,
      carb_g: 170,
      fat_g: 55,
    });
  }
}

describe("detectAccomplishments — target_adherence_streak", () => {
  it("emits the 7-day milestone after 7 consecutive on_track days", () => {
    const { db, userId } = setupWithCutPhase();
    seedOnTrackDays(db, userId, "2026-05-15", 7); // 2026-05-15 .. 2026-05-21
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    expect(wins.filter((w) => w.code === "target_adherence_streak").map((w) => w.value)).toEqual([
      7,
    ]);
  });

  it("a day with no meals logged breaks the streak (status null)", () => {
    const { db, userId } = setupWithCutPhase();
    // On-track 2026-05-15..21 except skip 2026-05-18 (no meals → null → break).
    for (const d of [
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
    ]) {
      createMeal(db, {
        user_id: userId,
        eaten_at: `${d}T16:00:00Z`,
        kcal: 1800,
        protein_g: 180,
        carb_g: 170,
        fat_g: 55,
      });
    }
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    // Streak from today back is only 3 days (21,20,19) — below the 7 threshold.
    expect(wins.filter((w) => w.code === "target_adherence_streak")).toEqual([]);
  });

  it("an untracked day does not break the streak (it is skipped, not counted)", () => {
    const { db, userId } = setupWithCutPhase();
    // 7 on-track tracked days straddling an untracked gap on 2026-05-18:
    //   14,15,16,17 (4) + [18 untracked] + 19,20,21 (3) = 7 on_track days.
    // If the gap BROKE the streak, only 19,20,21 (3) would count → no milestone.
    // Skipping the untracked day keeps the run unbroken → the value-7 fires.
    for (const d of [
      "2026-05-14",
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
    ]) {
      createMeal(db, {
        user_id: userId,
        eaten_at: `${d}T16:00:00Z`,
        kcal: 1800,
        protein_g: 180,
        carb_g: 170,
        fat_g: 55,
      });
    }
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-18",
      ended_on: "2026-05-18",
      reason: "vacation",
    });
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    expect(wins.filter((w) => w.code === "target_adherence_streak").map((w) => w.value)).toEqual([
      7,
    ]);
  });
});

function setupWithExercise(tz = "America/Toronto") {
  const db = freshDb();
  const userId = seedUser(db);
  updateUser(db, userId, { timezone: tz });
  const chest = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
  const push = createExercise(db, { user_id: userId, group_id: chest.id, name: "Push-up" });
  return { db, userId, pushExerciseId: push.id };
}

function logResistanceWorkout(
  db: Connection,
  userId: number,
  pushExerciseId: number,
  startedAt: string,
): void {
  createWorkout(db, {
    user_id: userId,
    started_at: startedAt,
    rpe: 8,
    exercises: [
      {
        exercise_id: pushExerciseId,
        display_order: 1,
        planned_sets: 1,
        sets: [{ reps: 10, weight_kg: 0 }],
      },
    ],
  });
}

describe("detectAccomplishments — workout_consistency", () => {
  it("emits the 4-week milestone when each of 4 consecutive weeks has a workout", () => {
    const { db, userId, pushExerciseId } = setupWithExercise();
    // now=2026-05-21 (Toronto). Week 0: 05-15..21, week 1: 05-08..14,
    // week 2: 05-01..07, week 3: 04-24..30. One workout per week.
    for (const startedAt of [
      "2026-05-20T17:00:00Z", // week 0
      "2026-05-12T17:00:00Z", // week 1
      "2026-05-05T17:00:00Z", // week 2
      "2026-04-28T17:00:00Z", // week 3
    ]) {
      logResistanceWorkout(db, userId, pushExerciseId, startedAt);
    }
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    expect(wins.filter((w) => w.code === "workout_consistency").map((w) => w.value)).toEqual([4]);
  });

  it("does not emit when a week in the run has no workout (only 3 of the last 4)", () => {
    const { db, userId, pushExerciseId } = setupWithExercise();
    for (const startedAt of [
      "2026-05-20T17:00:00Z", // week 0
      "2026-05-12T17:00:00Z", // week 1
      // week 2 intentionally empty → breaks the run at 2 consecutive weeks
      "2026-04-28T17:00:00Z", // week 3
    ]) {
      logResistanceWorkout(db, userId, pushExerciseId, startedAt);
    }
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    expect(wins.filter((w) => w.code === "workout_consistency")).toEqual([]);
  });

  it("buckets a late-night workout to its user-local week (not UTC)", () => {
    const { db, userId, pushExerciseId } = setupWithExercise();
    // 2026-05-15T02:30:00Z is 2026-05-14 22:30 ET → user-day 2026-05-14 (week 1),
    // NOT the UTC date 2026-05-15 (week 0). With workouts in weeks 1,2,3 plus
    // this one in week 1, weeks 0 has none → run from week 0 is length 0 → no
    // milestone. This asserts the late workout did NOT land in week 0.
    for (const startedAt of [
      "2026-05-15T02:30:00Z", // user-local 2026-05-14 → week 1
      "2026-05-05T17:00:00Z", // week 2
      "2026-04-28T17:00:00Z", // week 3
    ]) {
      logResistanceWorkout(db, userId, pushExerciseId, startedAt);
    }
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    // Week 0 has no workout → consecutive-from-0 run is 0 → no milestone.
    expect(wins.filter((w) => w.code === "workout_consistency")).toEqual([]);
  });

  it("counts cardio_sessions as NOT a resistance workout", () => {
    const { db, userId, pushExerciseId } = setupWithExercise();
    // Resistance workouts in weeks 0,1,2 only; week 3 gets a cardio session,
    // which must NOT count → run is 3 consecutive weeks → no 4-week milestone.
    for (const startedAt of [
      "2026-05-20T17:00:00Z",
      "2026-05-12T17:00:00Z",
      "2026-05-05T17:00:00Z",
    ]) {
      logResistanceWorkout(db, userId, pushExerciseId, startedAt);
    }
    createCardioSession(db, {
      user_id: userId,
      started_at: "2026-04-28T17:00:00Z",
      modality: "run",
      duration_min: 30,
      est_kcal: 300,
    });
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    expect(wins.filter((w) => w.code === "workout_consistency")).toEqual([]);
  });
});

function setupWithCutPhaseFrom(startedOn: string, tz = "America/Toronto") {
  const db = freshDb();
  const userId = seedUser(db);
  updateUser(db, userId, { timezone: tz });
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

describe("detectAccomplishments — weight_milestone", () => {
  it("emits value 1 and 2 when smoothed trend weight is >= 2 kg below phase start", () => {
    const { db, userId } = setupWithCutPhaseFrom("2026-04-01");
    // Daily weigh-ins from phase start trending down 0.07 kg/day. The smoothed
    // trend (half-life 10d) ends ~2.55 kg below the phase-start trend → floor 2.
    let cursor = "2026-04-01";
    let i = 0;
    while (cursor <= "2026-05-21") {
      const w = Math.round((85.0 - i * 0.07) * 100) / 100;
      createBodyWeight(db, { user_id: userId, measured_on: cursor, weight_kg: w });
      cursor = addDaysIso(cursor, 1);
      i += 1;
    }
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    const ms = wins.filter((w) => w.code === "weight_milestone").map((w) => w.value);
    expect(ms.sort((a, b) => a - b)).toEqual([1, 2]);
    const m1 = wins.find((w) => w.code === "weight_milestone" && w.value === 1);
    expect(m1?.earned_on).toBe("2026-05-21");
  });

  it("emits nothing when trend has not crossed a whole kg below phase start", () => {
    const { db, userId } = setupWithCutPhaseFrom("2026-05-01");
    // Essentially flat weight → trend never drops a full kg.
    let cursor = "2026-05-01";
    while (cursor <= "2026-05-21") {
      createBodyWeight(db, { user_id: userId, measured_on: cursor, weight_kg: 82 });
      cursor = addDaysIso(cursor, 1);
    }
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    expect(wins.filter((w) => w.code === "weight_milestone")).toEqual([]);
  });

  it("emits nothing when there is no active phase", () => {
    const { db, userId } = setup();
    for (let i = 0; i < 21; i++) {
      createBodyWeight(db, {
        user_id: userId,
        measured_on: addDaysIso("2026-05-01", i),
        weight_kg: 85 - i * 0.2,
      });
    }
    const wins = detectAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    expect(wins.filter((w) => w.code === "weight_milestone")).toEqual([]);
  });

  it("re-earns the same kg milestones in a NEW phase (per-phase dedup_key)", () => {
    // Phase 1 (2026-03-01..) loses ~2kg → persist earns weight_milestone 1,2.
    // Then a NEW phase starts (2026-05-01); the user loses ~2kg AGAIN inside it.
    // Because dedup_key embeds the phase id (`<phase_id>:<kg>`), the value-1/2
    // rows from phase 1 do NOT block the new phase — it re-earns 1,2.
    const { db, userId } = setupWithCutPhaseFrom("2026-03-01");

    // Phase-1 weigh-ins: down ~0.07 kg/day from 85.0 over its window.
    let cursor = "2026-03-01";
    let i = 0;
    while (cursor <= "2026-04-15") {
      const w = Math.round((85.0 - i * 0.07) * 100) / 100;
      createBodyWeight(db, { user_id: userId, measured_on: cursor, weight_kg: w });
      cursor = addDaysIso(cursor, 1);
      i += 1;
    }
    const phase1 = persistNewAccomplishments(db, userId, new Date("2026-04-15T20:00:00Z"));
    expect(
      phase1
        .filter((w) => w.code === "weight_milestone")
        .map((w) => w.value)
        .sort((a, b) => a - b),
    ).toEqual([1, 2]);

    // End phase 1 and start a fresh phase on 2026-05-01 (closeAndStartPhase
    // closes the active phase and opens a new one atomically).
    closeAndStartPhase(db, {
      user_id: userId,
      name: "cut2",
      intent: "cut",
      phase_type: "cut",
      tdee_at_phase_start: 2300,
      tdee_source: "user_asserted",
      deficit_kcal: -500,
      daily_kcal_target: 1850,
      base_protein_g: 180,
      base_carb_g: 165,
      base_fat_g: 58,
      started_on: "2026-05-01",
    });

    // Phase-2 weigh-ins: a fresh ~2kg drop within the new phase window, starting
    // from where phase 1 left off (~81.5 kg) so the trend within phase 2 falls ~2kg.
    cursor = "2026-05-01";
    i = 0;
    while (cursor <= "2026-06-15") {
      const w = Math.round((81.5 - i * 0.07) * 100) / 100;
      createBodyWeight(db, { user_id: userId, measured_on: cursor, weight_kg: w });
      cursor = addDaysIso(cursor, 1);
      i += 1;
    }
    const phase2 = persistNewAccomplishments(db, userId, new Date("2026-06-15T20:00:00Z"));
    // The SAME kg milestones (1, 2) are re-earned because the phase id differs.
    expect(
      phase2
        .filter((w) => w.code === "weight_milestone")
        .map((w) => w.value)
        .sort((a, b) => a - b),
    ).toEqual([1, 2]);

    // And both phases' rows coexist: 4 distinct weight_milestone rows total.
    const allWeightMs = listRecentAccomplishments(db, userId, "2026-01-01").filter(
      (r) => r.code === "weight_milestone",
    );
    expect(allWeightMs).toHaveLength(4);
  });
});

describe("detectAccomplishments — workout_total", () => {
  function seedWorkouts(db: Connection, userId: number, startedAtList: string[]): void {
    const groupId = createGroup(db, { user_id: userId, name: "Push" }).id;
    const exId = createExercise(db, { user_id: userId, group_id: groupId, name: "Bench" }).id;
    for (const startedAt of startedAtList) {
      createWorkout(db, {
        user_id: userId,
        started_at: startedAt,
        rpe: 7,
        exercises: [
          {
            exercise_id: exId,
            display_order: 1,
            planned_sets: 1,
            sets: { count: 1, reps: 5, weight_kg: 60 },
          },
        ],
      });
    }
  }

  it("fires the 50-workout milestone at exactly 50 and backdates to the 50th workout's day", () => {
    const { db, userId } = setup();
    const days: string[] = [];
    for (let i = 0; i < 50; i++) days.push(addDaysIso("2026-04-02", i));
    seedWorkouts(
      db,
      userId,
      days.map((d) => `${d}T16:00:00Z`),
    );
    const now = new Date(`${addDaysIso("2026-04-02", 49)}T20:00:00Z`);
    const candidates = detectAccomplishments(db, userId, now).filter(
      (c) => c.code === "workout_total",
    );
    const tier50 = candidates.find((c) => c.value === 50);
    expect(tier50).toBeDefined();
    expect(tier50?.earned_on).toBe(addDaysIso("2026-04-02", 49));
    expect(tier50?.dedup_key).toBe("50");
    expect(tier50?.message).toBe("50 workouts logged");
  });

  it("does not fire the 50 milestone at 49 workouts", () => {
    const { db, userId } = setup();
    const days: string[] = [];
    for (let i = 0; i < 49; i++) days.push(`${addDaysIso("2026-04-02", i)}T16:00:00Z`);
    seedWorkouts(db, userId, days);
    const now = new Date(`${addDaysIso("2026-04-02", 48)}T20:00:00Z`);
    const candidates = detectAccomplishments(db, userId, now).filter(
      (c) => c.code === "workout_total",
    );
    expect(candidates.find((c) => c.value === 50)).toBeUndefined();
  });

  it("backdates using user-local bucketing for a late-evening non-UTC workout", () => {
    const { db, userId } = setup(); // America/Toronto
    const days: string[] = [];
    for (let i = 0; i < 49; i++) days.push(`${addDaysIso("2026-04-02", i)}T16:00:00Z`);
    // 50th: 2026-05-21T01:00:00Z → Toronto 2026-05-20 21:00 → user-day 2026-05-20.
    days.push("2026-05-21T01:00:00Z");
    seedWorkouts(db, userId, days);
    const now = new Date("2026-05-21T20:00:00Z");
    const tier50 = detectAccomplishments(db, userId, now)
      .filter((c) => c.code === "workout_total")
      .find((c) => c.value === 50);
    expect(tier50?.earned_on).toBe("2026-05-20");
  });
});

describe("persistNewAccomplishments", () => {
  it("inserts new wins and is idempotent on re-run", () => {
    const { db, userId } = setup();
    for (let i = 0; i < 7; i++) {
      createBodyWeight(db, {
        user_id: userId,
        measured_on: `2026-05-${String(15 + i).padStart(2, "0")}`,
        weight_kg: 82,
      });
    }
    const now = new Date("2026-05-21T20:00:00Z");
    const first = persistNewAccomplishments(db, userId, now);
    expect(first.filter((w) => w.code === "weigh_in_streak")).toHaveLength(1);
    const second = persistNewAccomplishments(db, userId, now);
    expect(second).toEqual([]);
    expect(
      listRecentAccomplishments(db, userId, "2026-05-01").filter(
        (r) => r.code === "weigh_in_streak",
      ),
    ).toHaveLength(1);
  });

  it("a growing streak adds only the new threshold row", () => {
    const { db, userId } = setup();
    for (let i = 0; i < 7; i++) {
      createBodyWeight(db, {
        user_id: userId,
        measured_on: `2026-05-${String(8 + i).padStart(2, "0")}`,
        weight_kg: 82,
      });
    }
    persistNewAccomplishments(db, userId, new Date("2026-05-14T20:00:00Z"));
    for (let i = 7; i < 14; i++) {
      createBodyWeight(db, {
        user_id: userId,
        measured_on: `2026-05-${String(8 + i).padStart(2, "0")}`,
        weight_kg: 82,
      });
    }
    const added = persistNewAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    expect(added.filter((w) => w.code === "weigh_in_streak").map((w) => w.value)).toEqual([14]);
  });
});

describe("migration 012 — phase win codes", () => {
  it("accepts phase_complete and phase_halfway codes in the CHECK constraint", () => {
    const { db, userId } = setup();
    const a = insertAccomplishment(db, {
      user_id: userId,
      code: "phase_complete",
      earned_on: "2026-06-08",
      value: -4.2,
      dedup_key: "1",
      details_json: "{}",
    });
    const b = insertAccomplishment(db, {
      user_id: userId,
      code: "phase_halfway",
      earned_on: "2026-06-08",
      value: 21,
      dedup_key: "1",
      details_json: "{}",
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });
});

describe("getRecentAccomplishments", () => {
  it("returns recent wins with prior_best attached", () => {
    const { db, userId } = setup();
    insertAccomplishment(db, {
      user_id: userId,
      code: "weigh_in_streak",
      earned_on: "2026-05-01",
      value: 10,
      dedup_key: "10",
      details_json: '{"streak_days":10}',
    });
    insertAccomplishment(db, {
      user_id: userId,
      code: "weigh_in_streak",
      earned_on: "2026-05-21",
      value: 14,
      dedup_key: "14",
      details_json: '{"streak_days":14}',
    });
    const out = getRecentAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    const latest = out.accomplishments.find((a) => a.code === "weigh_in_streak" && a.value === 14);
    expect(latest?.prior_best).toEqual({ earned_on: "2026-05-01", value: 10 });
  });

  it("matches the AccomplishmentsResponseSchema shape", () => {
    const { db, userId } = setup();
    insertAccomplishment(db, {
      user_id: userId,
      code: "tdee_measured",
      earned_on: "2026-05-21",
      value: 0,
      dedup_key: "0",
      details_json: "{}",
    });
    const out = getRecentAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    expect(() => AccomplishmentsResponseSchema.parse(out)).not.toThrow();
  });

  it("includes wins within the 7-day window and excludes older ones", () => {
    const { db, userId } = setup();
    // 6 days before the as-of date (2026-05-15) → inside the 7-day window.
    insertAccomplishment(db, {
      user_id: userId,
      code: "weigh_in_streak",
      earned_on: "2026-05-15",
      value: 7,
      dedup_key: "7",
      details_json: "{}",
    });
    // 8 days before the as-of date (2026-05-13) → outside the 7-day window.
    insertAccomplishment(db, {
      user_id: userId,
      code: "weigh_in_streak",
      earned_on: "2026-05-13",
      value: 14,
      dedup_key: "14",
      details_json: "{}",
    });
    const out = getRecentAccomplishments(db, userId, new Date("2026-05-21T20:00:00Z"));
    const values = out.accomplishments
      .filter((a) => a.code === "weigh_in_streak")
      .map((a) => a.value);
    expect(values).toEqual([7]); // only the in-window (05-15) one
  });
});

describe("getRecentAccomplishments — unit-aware messages (imperial)", () => {
  // The read path rebuilds each message via messageFor honoring the user's
  // preferred_unit_system. For an imperial user, the four weight-bearing codes
  // (weight_milestone, strength_pr, phase_complete, volume_total) render the
  // weight figure in lb; the raw numeric `value` stays kg (documented contract:
  // the canonical unit is kg; only the human prose converts).
  function setupImperial() {
    const { db, userId } = setup();
    updateUser(db, userId, { preferred_unit_system: "imperial" });
    return { db, userId };
  }

  const asOf = new Date("2026-05-21T20:00:00Z");
  const find = (out: AccomplishmentsResponse, code: string) =>
    out.accomplishments.find((a) => a.code === code);

  it("renders strength_pr e1RM in lb but keeps value in kg", () => {
    const { db, userId } = setupImperial();
    insertAccomplishment(db, {
      user_id: userId,
      code: "strength_pr",
      earned_on: "2026-05-20",
      value: 96.5, // kg
      dedup_key: "7:96.5",
      details_json: '{"exercise_id":7,"exercise_name":"Bench"}',
    });
    const pr = find(getRecentAccomplishments(db, userId, asOf), "strength_pr");
    // 96.5 kg * 2.20462262 = 212.746… → floor5 = 210 lb
    expect(pr?.message).toBe("New PR: Bench e1RM 210 lb");
    expect(pr?.value).toBe(96.5); // value stays kg
  });

  it("renders weight_milestone in lb", () => {
    const { db, userId } = setupImperial();
    insertAccomplishment(db, {
      user_id: userId,
      code: "weight_milestone",
      earned_on: "2026-05-20",
      value: 2, // kg down
      dedup_key: "1:2",
      details_json: "{}",
    });
    const m = find(getRecentAccomplishments(db, userId, asOf), "weight_milestone");
    // 2 kg * 2.20462262 = 4.409… → 4.4 lb
    expect(m?.message).toBe("Down 4.4 lb from phase start");
  });

  it("renders phase_complete signed delta in lb", () => {
    const { db, userId } = setupImperial();
    insertAccomplishment(db, {
      user_id: userId,
      code: "phase_complete",
      earned_on: "2026-05-20",
      value: -5, // kg (a cut)
      dedup_key: "p1",
      details_json: '{"phase_type":"cut","weeks":8}',
    });
    const p = find(getRecentAccomplishments(db, userId, asOf), "phase_complete");
    // -5 kg * 2.20462262 = -11.023… → -11 lb, sign preserved
    expect(p?.message).toBe("Cut complete: -11 lb over 8 weeks");
  });

  it("renders volume_total lifetime tonnage in lb with grouping", () => {
    const { db, userId } = setupImperial();
    insertAccomplishment(db, {
      user_id: userId,
      code: "volume_total",
      earned_on: "2026-05-20",
      value: 100000, // kg lifted
      dedup_key: "100000",
      details_json: '{"total_kg":100000}',
    });
    const v = find(getRecentAccomplishments(db, userId, asOf), "volume_total");
    // 100000 kg * 2.20462262 = 220462.262 → 220,462 lb (rounded, en-US grouped)
    expect(v?.message).toBe("220,462 lb lifted");
  });

  it("leaves a non-weight code (weigh_in_streak) unchanged for imperial", () => {
    const { db, userId } = setupImperial();
    insertAccomplishment(db, {
      user_id: userId,
      code: "weigh_in_streak",
      earned_on: "2026-05-20",
      value: 14,
      dedup_key: "14",
      details_json: "{}",
    });
    const s = find(getRecentAccomplishments(db, userId, asOf), "weigh_in_streak");
    expect(s?.message).toBe("14-day weigh-in streak");
  });

  it("keeps kg in messages for a metric user", () => {
    const { db, userId } = setup(); // default metric
    insertAccomplishment(db, {
      user_id: userId,
      code: "strength_pr",
      earned_on: "2026-05-20",
      value: 96.5,
      dedup_key: "7:96.5",
      details_json: '{"exercise_id":7,"exercise_name":"Bench"}',
    });
    const pr = find(getRecentAccomplishments(db, userId, asOf), "strength_pr");
    expect(pr?.message).toBe("New PR: Bench e1RM 95 kg");
  });

  // Drift guard: WEIGHT_VALUE_CODES (the set the display layers use to convert
  // raw value fields) must stay in sync with the codes whose messageFor output
  // actually changes between metric and imperial. This asserts the invariant in
  // BOTH directions — adding a weight case to messageFor without adding the code
  // to WEIGHT_VALUE_CODES (or vice versa) fails here, even though typecheck/lint
  // would pass. A value of 7 is used so the converted figure (7 kg → 15.4 lb)
  // visibly differs; sleep_recovery's 0 sentinel is exercised separately above.
  it("WEIGHT_VALUE_CODES exactly matches the codes messageFor converts", () => {
    // Seed one value-7 row of `code` and return its rebuilt message for the
    // given unit system. value 7 makes a converted figure (7 kg → 15.4 lb)
    // visibly differ from the kg form for any weight-bearing code.
    const messageFor = (code: string, system: "metric" | "imperial"): string | undefined => {
      const { db, userId } = setup();
      updateUser(db, userId, { preferred_unit_system: system });
      insertAccomplishment(db, {
        user_id: userId,
        code,
        earned_on: "2026-05-20",
        value: 7,
        dedup_key: `${code}:7`,
        // exercise_name keeps strength_pr's message stable; extra keys are ignored.
        details_json: '{"exercise_id":1,"exercise_name":"Bench","phase_type":"cut","weeks":8}',
      });
      return find(getRecentAccomplishments(db, userId, asOf), code)?.message;
    };

    const codesThatConvert = new Set<string>();
    for (const code of AccomplishmentCodeSchema.options) {
      if (messageFor(code, "metric") !== messageFor(code, "imperial")) codesThatConvert.add(code);
    }
    expect(codesThatConvert).toEqual(WEIGHT_VALUE_CODES);
  });
});

describe("detectAccomplishments — strength_pr", () => {
  // Seed one exercise's single set on a given day. weight/reps drive e1RM.
  function logSet(
    db: Connection,
    userId: number,
    exId: number,
    startedAt: string,
    weight: number,
    reps: number,
  ) {
    createWorkout(db, {
      user_id: userId,
      started_at: startedAt,
      rpe: 8,
      exercises: [
        {
          exercise_id: exId,
          display_order: 1,
          planned_sets: 1,
          sets: [{ reps, weight_kg: weight }],
        },
      ],
    });
  }

  it("does NOT fire on the first-ever session (baseline only)", () => {
    const { db, userId, pushExerciseId } = setupWithExercise();
    logSet(db, userId, pushExerciseId, "2026-06-01T16:00:00Z", 80, 5);
    const wins = detectAccomplishments(db, userId, new Date("2026-06-01T17:00:00Z"));
    expect(wins.filter((w) => w.code === "strength_pr")).toEqual([]);
  });

  it("fires when a later session beats the prior best e1RM", () => {
    const { db, userId, pushExerciseId } = setupWithExercise();
    logSet(db, userId, pushExerciseId, "2026-06-01T16:00:00Z", 80, 5); // e1RM = 80*(1+5/30) ≈ 93.33
    logSet(db, userId, pushExerciseId, "2026-06-05T16:00:00Z", 82.5, 5); // e1RM = 82.5*(1+5/30) ≈ 96.25
    const wins = detectAccomplishments(db, userId, new Date("2026-06-05T17:00:00Z"));
    const pr = wins.filter((w) => w.code === "strength_pr");
    expect(pr).toHaveLength(1);
    expect(pr[0]?.value).toBe(96.5); // 96.25 rounded to 0.5
    expect(pr[0]?.dedup_key).toBe(`${pushExerciseId}:96.5`);
    expect(pr[0]?.earned_on).toBe("2026-06-05");
    expect(pr[0]?.details.exercise_id).toBe(pushExerciseId);
    expect(pr[0]?.details.weight_kg).toBe(82.5);
    expect(pr[0]?.details.reps).toBe(5);
    expect(pr[0]?.details.prior_e1rm).toBe(93.5); // 93.33 rounded to 0.5
  });

  it("does NOT fire on a tie (must strictly beat)", () => {
    const { db, userId, pushExerciseId } = setupWithExercise();
    logSet(db, userId, pushExerciseId, "2026-06-01T16:00:00Z", 80, 5);
    logSet(db, userId, pushExerciseId, "2026-06-05T16:00:00Z", 80, 5);
    const wins = detectAccomplishments(db, userId, new Date("2026-06-05T17:00:00Z"));
    expect(wins.filter((w) => w.code === "strength_pr")).toEqual([]);
  });

  it("excludes high-rep sets (>12 reps) from e1RM", () => {
    const { db, userId, pushExerciseId } = setupWithExercise();
    logSet(db, userId, pushExerciseId, "2026-06-01T16:00:00Z", 80, 5);
    logSet(db, userId, pushExerciseId, "2026-06-05T16:00:00Z", 70, 20); // 20 reps → excluded
    const wins = detectAccomplishments(db, userId, new Date("2026-06-05T17:00:00Z"));
    expect(wins.filter((w) => w.code === "strength_pr")).toEqual([]);
  });

  it("excludes bodyweight (0 weight) sets", () => {
    const { db, userId, pushExerciseId } = setupWithExercise();
    logSet(db, userId, pushExerciseId, "2026-06-01T16:00:00Z", 80, 5);
    logSet(db, userId, pushExerciseId, "2026-06-05T16:00:00Z", 0, 5);
    const wins = detectAccomplishments(db, userId, new Date("2026-06-05T17:00:00Z"));
    expect(wins.filter((w) => w.code === "strength_pr")).toEqual([]);
  });

  it("returns nothing when the user has no workouts at all", () => {
    const { db, userId } = setupWithExercise();
    const wins = detectAccomplishments(db, userId, new Date("2026-06-05T17:00:00Z"));
    expect(wins.filter((w) => w.code === "strength_pr")).toEqual([]);
  });

  it("buckets earned_on to the user-local day for a non-UTC evening session", () => {
    const { db, userId, pushExerciseId } = setupWithExercise(); // Toronto tz
    logSet(db, userId, pushExerciseId, "2026-06-01T16:00:00Z", 80, 5);
    // 2026-06-06 01:30Z = 2026-06-05 21:30 EDT → user-local day 2026-06-05
    logSet(db, userId, pushExerciseId, "2026-06-06T01:30:00Z", 85, 5);
    const wins = detectAccomplishments(db, userId, new Date("2026-06-06T02:00:00Z"));
    const pr = wins.filter((w) => w.code === "strength_pr");
    expect(pr).toHaveLength(1);
    expect(pr[0]?.earned_on).toBe("2026-06-05");
  });
});

describe("getRecentAccomplishments — strength_pr", () => {
  it("scopes prior_best to the SAME exercise and renders the PR message", () => {
    const { db, userId } = setup();
    const now = new Date("2026-06-08T17:00:00Z");
    // Bench (ex 3) prior PR at 93.5, then a new 96.5 PR today.
    insertAccomplishment(db, {
      user_id: userId,
      code: "strength_pr",
      earned_on: "2026-06-03",
      value: 93.5,
      dedup_key: "3:93.5",
      details_json: '{"exercise_id":3,"exercise_name":"Bench Press"}',
    });
    insertAccomplishment(db, {
      user_id: userId,
      code: "strength_pr",
      earned_on: "2026-06-08",
      value: 96.5,
      dedup_key: "3:96.5",
      details_json: '{"exercise_id":3,"exercise_name":"Bench Press"}',
    });
    // A HIGHER Squat (ex 7) e1RM that must NOT become Bench's prior_best.
    insertAccomplishment(db, {
      user_id: userId,
      code: "strength_pr",
      earned_on: "2026-06-08",
      value: 140,
      dedup_key: "7:140",
      details_json: '{"exercise_id":7,"exercise_name":"Squat"}',
    });

    const out = getRecentAccomplishments(db, userId, now);
    const benchPr = out.accomplishments.find((a) => a.code === "strength_pr" && a.value === 96.5);
    expect(benchPr?.message).toBe("New PR: Bench Press e1RM 95 kg");
    expect(benchPr?.prior_best).toEqual({ earned_on: "2026-06-03", value: 93.5 });
  });
});

describe("detectAccomplishments — phase_complete", () => {
  function seedEndedPhase(
    db: ReturnType<typeof setup>["db"],
    userId: number,
    phaseType: "cut" | "bulk" | "maintenance",
    series: Array<{ on: string; kg: number }>,
    started_on: string,
    ended_on: string,
  ) {
    const phase = closeAndStartPhase(db, {
      user_id: userId,
      name: phaseType,
      intent: phaseType === "maintenance" ? "maintenance" : phaseType,
      phase_type: phaseType,
      tdee_at_phase_start: 2500,
      tdee_source: "user_asserted",
      deficit_kcal: phaseType === "bulk" ? 300 : phaseType === "cut" ? -500 : 0,
      daily_kcal_target: 2000,
      base_protein_g: 180,
      base_carb_g: 200,
      base_fat_g: 60,
      started_on,
    });
    for (const s of series) {
      createBodyWeight(db, { user_id: userId, measured_on: s.on, weight_kg: s.kg });
    }
    db.prepare("UPDATE nutrition_phases SET ended_on = ? WHERE id = ?").run(ended_on, phase.id);
    return phase;
  }

  it("mints a phase_complete with a signed downward delta for an ended cut", () => {
    const { db, userId } = setup();
    seedEndedPhase(
      db,
      userId,
      "cut",
      [
        { on: "2026-04-01", kg: 84 },
        { on: "2026-04-15", kg: 82 },
        { on: "2026-05-01", kg: 80 },
      ],
      "2026-04-01",
      "2026-05-01",
    );
    const cands = detectAccomplishments(db, userId, new Date("2026-05-10T12:00:00Z"));
    const win = cands.find((c) => c.code === "phase_complete");
    expect(win).toBeDefined();
    if (win === undefined) throw new Error("no phase_complete candidate");
    expect(win.value).toBeLessThan(0);
    expect(win.dedup_key).toMatch(/^\d+$/);
    expect(win.details.phase_type).toBe("cut");
    expect(win.details.weeks).toBe(4);
  });

  it("mints an upward delta for an ended bulk", () => {
    const { db, userId } = setup();
    seedEndedPhase(
      db,
      userId,
      "bulk",
      [
        { on: "2026-04-01", kg: 78 },
        { on: "2026-04-15", kg: 79 },
        { on: "2026-05-01", kg: 80 },
      ],
      "2026-04-01",
      "2026-05-01",
    );
    const cands = detectAccomplishments(db, userId, new Date("2026-05-10T12:00:00Z"));
    const win = cands.find((c) => c.code === "phase_complete");
    expect(win?.value).toBeGreaterThan(0);
    expect(win?.details.phase_type).toBe("bulk");
  });

  it("does NOT mint for a cut that gained weight (wrong direction)", () => {
    const { db, userId } = setup();
    seedEndedPhase(
      db,
      userId,
      "cut",
      [
        { on: "2026-04-01", kg: 80 },
        { on: "2026-05-01", kg: 82 },
      ],
      "2026-04-01",
      "2026-05-01",
    );
    const cands = detectAccomplishments(db, userId, new Date("2026-05-10T12:00:00Z"));
    expect(cands.find((c) => c.code === "phase_complete")).toBeUndefined();
  });

  it("does NOT mint for a maintenance phase", () => {
    const { db, userId } = setup();
    seedEndedPhase(
      db,
      userId,
      "maintenance",
      [
        { on: "2026-04-01", kg: 80 },
        { on: "2026-05-01", kg: 79 },
      ],
      "2026-04-01",
      "2026-05-01",
    );
    const cands = detectAccomplishments(db, userId, new Date("2026-05-10T12:00:00Z"));
    expect(cands.find((c) => c.code === "phase_complete")).toBeUndefined();
  });

  it("does NOT mint when fewer than 2 weigh-ins fall in the phase window", () => {
    const { db, userId } = setup();
    seedEndedPhase(db, userId, "cut", [{ on: "2026-04-01", kg: 80 }], "2026-04-01", "2026-05-01");
    const cands = detectAccomplishments(db, userId, new Date("2026-05-10T12:00:00Z"));
    expect(cands.find((c) => c.code === "phase_complete")).toBeUndefined();
  });

  it("does NOT mint when ended_on is older than the lookback window", () => {
    const { db, userId } = setup();
    seedEndedPhase(
      db,
      userId,
      "cut",
      [
        { on: "2026-01-01", kg: 84 },
        { on: "2026-02-01", kg: 80 },
      ],
      "2026-01-01",
      "2026-02-01",
    );
    const cands = detectAccomplishments(db, userId, new Date("2026-05-10T12:00:00Z"));
    expect(cands.find((c) => c.code === "phase_complete")).toBeUndefined();
  });

  it("clamps a sub-week phase to 1 week rather than reporting 0", () => {
    const { db, userId } = setup();
    // 3-day cut: round(3/7) = 0, must clamp to 1.
    seedEndedPhase(
      db,
      userId,
      "cut",
      [
        { on: "2026-05-01", kg: 80 },
        { on: "2026-05-03", kg: 79 },
      ],
      "2026-05-01",
      "2026-05-03",
    );
    const cands = detectAccomplishments(db, userId, new Date("2026-05-10T12:00:00Z"));
    const win = cands.find((c) => c.code === "phase_complete");
    expect(win?.details.weeks).toBe(1);
  });
});

describe("detectAccomplishments — phase_halfway", () => {
  function startActiveCutWithPlannedEnd(
    db: ReturnType<typeof setup>["db"],
    userId: number,
    started_on: string,
    planned_end_on: string,
  ) {
    return closeAndStartPhase(db, {
      user_id: userId,
      name: "Cut",
      intent: "cut",
      phase_type: "cut",
      tdee_at_phase_start: 2500,
      tdee_source: "user_asserted",
      deficit_kcal: -500,
      daily_kcal_target: 2000,
      base_protein_g: 180,
      base_carb_g: 200,
      base_fat_g: 60,
      started_on,
      planned_end_on,
    });
  }

  it("fires at exactly the midpoint of a planned phase", () => {
    const { db, userId } = setup();
    // 2026-05-01 .. 2026-05-21 = 20 planned days; midpoint = ceil(20/2) = 10.
    startActiveCutWithPlannedEnd(db, userId, "2026-05-01", "2026-05-21");
    // today = 2026-05-11 → daysIn = 10 → fires.
    const cands = detectAccomplishments(db, userId, new Date("2026-05-11T12:00:00Z"));
    const win = cands.find((c) => c.code === "phase_halfway");
    expect(win).toBeDefined();
    expect(win?.value).toBe(10);
    expect(win?.dedup_key).toMatch(/^\d+$/);
    expect(win?.details.planned_days).toBe(20);
  });

  it("does NOT fire the day before the midpoint", () => {
    const { db, userId } = setup();
    startActiveCutWithPlannedEnd(db, userId, "2026-05-01", "2026-05-21");
    // today = 2026-05-10 → daysIn = 9 < 10 → no fire.
    const cands = detectAccomplishments(db, userId, new Date("2026-05-10T12:00:00Z"));
    expect(cands.find((c) => c.code === "phase_halfway")).toBeUndefined();
  });

  it("does NOT fire when the active phase has no planned_end_on", () => {
    const { db, userId } = setup();
    closeAndStartPhase(db, {
      user_id: userId,
      name: "Cut",
      intent: "cut",
      phase_type: "cut",
      tdee_at_phase_start: 2500,
      tdee_source: "user_asserted",
      deficit_kcal: -500,
      daily_kcal_target: 2000,
      base_protein_g: 180,
      base_carb_g: 200,
      base_fat_g: 60,
      started_on: "2026-05-01",
    });
    const cands = detectAccomplishments(db, userId, new Date("2026-05-20T12:00:00Z"));
    expect(cands.find((c) => c.code === "phase_halfway")).toBeUndefined();
  });

  it("does NOT fire once today is past planned_end_on", () => {
    const { db, userId } = setup();
    startActiveCutWithPlannedEnd(db, userId, "2026-05-01", "2026-05-21");
    // today = 2026-05-25 → past planned end → no halfway (it's a completion-in-waiting).
    const cands = detectAccomplishments(db, userId, new Date("2026-05-25T12:00:00Z"));
    expect(cands.find((c) => c.code === "phase_halfway")).toBeUndefined();
  });
});

describe("getRecentAccomplishments — phase wins", () => {
  it("rebuilds the phase_complete message from details and forces prior_best null", () => {
    const { db, userId } = setup();
    insertAccomplishment(db, {
      user_id: userId,
      code: "phase_complete",
      earned_on: "2026-06-08",
      value: -4.2,
      dedup_key: "1",
      details_json: JSON.stringify({ phase_type: "cut", weeks: 10 }),
    });
    // An older, "bigger" phase_complete that must NOT surface as a prior_best.
    insertAccomplishment(db, {
      user_id: userId,
      code: "phase_complete",
      earned_on: "2026-03-01",
      value: -6.0,
      dedup_key: "2",
      details_json: JSON.stringify({ phase_type: "cut", weeks: 12 }),
    });
    const res = getRecentAccomplishments(db, userId, new Date("2026-06-09T12:00:00Z"));
    const row = res.accomplishments.find((a) => a.code === "phase_complete");
    expect(row?.message).toBe("Cut complete: -4.2 kg over 10 weeks");
    expect(row?.prior_best).toBeNull();
  });

  it("rebuilds the phase_halfway message from details", () => {
    const { db, userId } = setup();
    insertAccomplishment(db, {
      user_id: userId,
      code: "phase_halfway",
      earned_on: "2026-06-08",
      value: 10,
      dedup_key: "1",
      details_json: JSON.stringify({ phase_type: "cut", days_in: 10, planned_days: 20 }),
    });
    const res = getRecentAccomplishments(db, userId, new Date("2026-06-09T12:00:00Z"));
    const row = res.accomplishments.find((a) => a.code === "phase_halfway");
    expect(row?.message).toBe("Halfway through your cut — 10/20 days");
    expect(row?.prior_best).toBeNull();
  });
});

describe("computeAccomplishmentAggregates", () => {
  it("computeAccomplishmentAggregates counts totals and per-type bests", () => {
    const aggs = computeAccomplishmentAggregates([
      {
        code: "weigh_in_streak",
        earned_on: "2026-05-01",
        value: 7,
        message: "",
        details: {},
        prior_best: null,
      },
      {
        code: "weigh_in_streak",
        earned_on: "2026-06-01",
        value: 14,
        message: "",
        details: {},
        prior_best: null,
      },
      {
        code: "weight_milestone",
        earned_on: "2026-06-02",
        value: 3,
        message: "",
        details: {},
        prior_best: null,
      },
      {
        code: "tdee_measured",
        earned_on: "2026-04-01",
        value: 0,
        message: "",
        details: {},
        prior_best: null,
      },
      {
        code: "target_adherence_streak",
        earned_on: "2026-05-10",
        value: 7,
        message: "",
        details: {},
        prior_best: null,
      },
    ]);
    expect(aggs.total).toBe(5);
    expect(aggs.by_type.weigh_in_streak).toBe(2);
    expect(aggs.by_type.weight_milestone).toBe(1);
    expect(aggs.by_type.tdee_measured).toBe(1);
    expect(aggs.by_type.workout_consistency).toBe(0);
    expect(aggs.by_type.target_adherence_streak).toBe(1);
    expect(aggs.best_by_type.weigh_in_streak).toEqual({ value: 14, earned_on: "2026-06-01" });
    expect(aggs.best_by_type.weight_milestone).toEqual({ value: 3, earned_on: "2026-06-02" });
    expect(aggs.best_by_type.tdee_measured).toBeNull();
    expect(aggs.best_by_type.target_adherence_streak).toEqual({
      value: 7,
      earned_on: "2026-05-10",
    });
  });

  it("computeAccomplishmentAggregates zeroes everything for empty history", () => {
    const aggs = computeAccomplishmentAggregates([]);
    expect(aggs.total).toBe(0);
    expect(aggs.by_type.weigh_in_streak).toBe(0);
    expect(aggs.best_by_type.weigh_in_streak).toBeNull();
  });

  it("computeAccomplishmentAggregates keeps the earliest date on a value tie", () => {
    // same value (e.g. weight_milestone 2kg in two phases) given in BOTH orders
    const newestFirst = computeAccomplishmentAggregates([
      {
        code: "weight_milestone",
        earned_on: "2026-06-01",
        value: 2,
        message: "",
        details: {},
        prior_best: null,
      },
      {
        code: "weight_milestone",
        earned_on: "2026-03-01",
        value: 2,
        message: "",
        details: {},
        prior_best: null,
      },
    ]);
    const oldestFirst = computeAccomplishmentAggregates([
      {
        code: "weight_milestone",
        earned_on: "2026-03-01",
        value: 2,
        message: "",
        details: {},
        prior_best: null,
      },
      {
        code: "weight_milestone",
        earned_on: "2026-06-01",
        value: 2,
        message: "",
        details: {},
        prior_best: null,
      },
    ]);
    // earliest date wins regardless of input order
    expect(newestFirst.best_by_type.weight_milestone).toEqual({
      value: 2,
      earned_on: "2026-03-01",
    });
    expect(oldestFirst.best_by_type.weight_milestone).toEqual({
      value: 2,
      earned_on: "2026-03-01",
    });
  });
});

describe("getAccomplishmentHistory", () => {
  it("getAccomplishmentHistory returns full timeline + aggregates, scoped to user", () => {
    const db = freshDb();
    const userId = seedUser(db);
    insertAccomplishment(db, {
      user_id: userId,
      code: "weigh_in_streak",
      earned_on: "2026-01-15",
      value: 7,
      dedup_key: "7",
      details_json: '{"streak_days":7}',
    });
    insertAccomplishment(db, {
      user_id: userId,
      code: "weigh_in_streak",
      earned_on: "2026-06-01",
      value: 14,
      dedup_key: "14",
      details_json: '{"streak_days":14}',
    });
    const res = getAccomplishmentHistory(db, userId, new Date("2026-06-08T12:00:00Z"));
    expect(res.accomplishments.map((a) => a.earned_on)).toEqual(["2026-06-01", "2026-01-15"]);
    const newest = res.accomplishments[0];
    expect(newest?.prior_best).toEqual({ earned_on: "2026-01-15", value: 7 });
    expect(res.aggregates.total).toBe(2);
    expect(res.aggregates.best_by_type.weigh_in_streak).toEqual({
      value: 14,
      earned_on: "2026-06-01",
    });
  });
});

describe("detectAccomplishments — meal_total & weigh_in_total", () => {
  it("meal_total fires at 100 meals, backdated to the 100th meal's user-local day", () => {
    const { db, userId } = setup();
    let count = 0;
    let dayIndex = 0;
    while (count < 100) {
      const d = addDaysIso("2026-03-01", dayIndex);
      createMeal(db, {
        user_id: userId,
        eaten_at: `${d}T16:00:00Z`,
        kcal: 600,
        protein_g: 40,
        carb_g: 60,
        fat_g: 20,
      });
      count++;
      if (count < 100) {
        createMeal(db, {
          user_id: userId,
          eaten_at: `${d}T22:00:00Z`,
          kcal: 600,
          protein_g: 40,
          carb_g: 60,
          fat_g: 20,
        });
        count++;
      }
      dayIndex++;
    }
    const now = new Date(`${addDaysIso("2026-03-01", dayIndex)}T20:00:00Z`);
    const tier = detectAccomplishments(db, userId, now)
      .filter((c) => c.code === "meal_total")
      .find((c) => c.value === 100);
    expect(tier).toBeDefined();
    expect(tier?.message).toBe("100 meals logged");
    expect(tier?.earned_on).toBe(addDaysIso("2026-03-01", 49));
  });

  it("weigh_in_total fires at 50 weigh-ins, backdated to the 50th measured_on", () => {
    const { db, userId } = setup();
    for (let i = 0; i < 50; i++) {
      createBodyWeight(db, {
        user_id: userId,
        measured_on: addDaysIso("2026-04-01", i),
        weight_kg: 80,
      });
    }
    const now = new Date(`${addDaysIso("2026-04-01", 50)}T20:00:00Z`);
    const tier = detectAccomplishments(db, userId, now)
      .filter((c) => c.code === "weigh_in_total")
      .find((c) => c.value === 50);
    expect(tier).toBeDefined();
    expect(tier?.message).toBe("50 weigh-ins logged");
    expect(tier?.earned_on).toBe(addDaysIso("2026-04-01", 49));
  });

  it("weigh_in_total does not fire at 49 weigh-ins", () => {
    const { db, userId } = setup();
    for (let i = 0; i < 49; i++) {
      createBodyWeight(db, {
        user_id: userId,
        measured_on: addDaysIso("2026-04-01", i),
        weight_kg: 80,
      });
    }
    const now = new Date(`${addDaysIso("2026-04-01", 49)}T20:00:00Z`);
    const candidates = detectAccomplishments(db, userId, now).filter(
      (c) => c.code === "weigh_in_total",
    );
    expect(candidates.find((c) => c.value === 50)).toBeUndefined();
  });
});

describe("detectAccomplishments — volume_total", () => {
  function seedVolume(
    db: Connection,
    userId: number,
    entries: Array<{ startedAt: string; reps: number; weight_kg: number | null; count: number }>,
  ): void {
    const groupId = createGroup(db, { user_id: userId, name: "Legs" }).id;
    const exId = createExercise(db, { user_id: userId, group_id: groupId, name: "Squat" }).id;
    for (const e of entries) {
      createWorkout(db, {
        user_id: userId,
        started_at: e.startedAt,
        rpe: 8,
        exercises: [
          {
            exercise_id: exId,
            display_order: 1,
            planned_sets: e.count,
            sets: { count: e.count, reps: e.reps, weight_kg: e.weight_kg },
          },
        ],
      });
    }
  }

  it("fires the 100k-kg tier on the workout day where the cumulative sum crosses it", () => {
    const { db, userId } = setup();
    // A (2026-02-01): 50 sets × 5 × 100 = 25,000. B (2026-02-08): 200 sets × 5 × 100 = 100,000.
    // Cumulative after A = 25,000 (<100k); after B = 125,000 (>=100k) → tier on B's day.
    seedVolume(db, userId, [
      { startedAt: "2026-02-01T16:00:00Z", reps: 5, weight_kg: 100, count: 50 },
      { startedAt: "2026-02-08T16:00:00Z", reps: 5, weight_kg: 100, count: 200 },
    ]);
    const now = new Date("2026-02-09T20:00:00Z");
    const tier = detectAccomplishments(db, userId, now)
      .filter((c) => c.code === "volume_total")
      .find((c) => c.value === 100_000);
    expect(tier).toBeDefined();
    expect(tier?.earned_on).toBe("2026-02-08");
    expect(tier?.message).toBe("100,000 kg lifted");
    expect(tier?.dedup_key).toBe("100000");
  });

  it("excludes bodyweight (weight_kg IS NULL) sets from the accumulated volume", () => {
    const { db, userId } = setup();
    // Weighted volume = 200 × 5 × 100 = 100,000 → crosses 100k, well below 250k.
    // The null-weight pile would, IF (incorrectly) counted at 100 kg, add
    // 400 × 5 × 100 = 200,000 → pushing the running total to 300,000 and
    // inflating it past the 250k tier. The detector's SQL `WHERE s.weight_kg
    // IS NOT NULL` drops those rows before they reach the sum.
    //
    // Honest caveat: this is NOT an airtight test of the SQL filter in
    // isolation. In JS `reps * NULL === 0` (and SQLite `reps * NULL === NULL`,
    // treated as 0 here), so even if the `IS NOT NULL` filter were removed the
    // null-weight rows would contribute nothing to `running` — the arithmetic
    // alone zeroes them. A truly airtight test of the filter is not reachable
    // through the public detectAccomplishments API, because there's no way to
    // give a null-weight set a non-zero contribution without also giving it a
    // weight (at which point it's no longer null). So this is a defense-in-depth
    // check: it would catch a regression that, say, coalesced NULL weight to a
    // fallback constant, but it cannot catch a bare filter removal.
    //
    // The load-bearing, non-vacuous assertion is on `details.total_kg`: it must
    // equal the WEIGHTED-only sum (100,000), proving the null sets contributed
    // nothing to the accumulated total at the moment the tier fired.
    seedVolume(db, userId, [
      { startedAt: "2026-02-01T16:00:00Z", reps: 5, weight_kg: 100, count: 200 }, // 100,000 weighted
      { startedAt: "2026-02-02T16:00:00Z", reps: 5, weight_kg: null, count: 400 }, // null → excluded
    ]);
    const now = new Date("2026-02-03T20:00:00Z");
    const candidates = detectAccomplishments(db, userId, now).filter(
      (c) => c.code === "volume_total",
    );
    const hundredK = candidates.find((c) => c.value === 100_000);
    expect(hundredK).toBeDefined();
    // Weighted-only sum at the crossing — NOT 300,000. Proves null sets did not
    // add to the accumulated total.
    expect(hundredK?.details.total_kg).toBe(100_000);
    expect(candidates.find((c) => c.value === 250_000)).toBeUndefined();
  });

  it("fires every tier a single workout's volume jumps past, all on that day", () => {
    const { db, userId } = setup();
    // One workout day with 1,200 sets × 5 × 100 = 600,000 kg in a single go,
    // crossing 100k, 250k, and 500k at once via the detector's inner while-loop.
    // Stays below the 1M tier. setup() uses America/Toronto; 16:00:00Z buckets
    // to the same calendar date there, so earned_on is that workout's local day.
    seedVolume(db, userId, [
      { startedAt: "2026-02-01T16:00:00Z", reps: 5, weight_kg: 100, count: 1200 }, // 600,000
    ]);
    const now = new Date("2026-02-02T20:00:00Z");
    const candidates = detectAccomplishments(db, userId, now).filter(
      (c) => c.code === "volume_total",
    );
    const v100 = candidates.find((c) => c.value === 100_000);
    const v250 = candidates.find((c) => c.value === 250_000);
    const v500 = candidates.find((c) => c.value === 500_000);
    expect(v100).toBeDefined();
    expect(v250).toBeDefined();
    expect(v500).toBeDefined();
    expect(v100?.earned_on).toBe("2026-02-01");
    expect(v250?.earned_on).toBe("2026-02-01");
    expect(v500?.earned_on).toBe("2026-02-01");
    expect(candidates.find((c) => c.value === 1_000_000)).toBeUndefined();
  });

  it("does not fire when cumulative volume is below the lowest tier", () => {
    const { db, userId } = setup();
    seedVolume(db, userId, [
      { startedAt: "2026-02-01T16:00:00Z", reps: 5, weight_kg: 100, count: 10 }, // 5,000
    ]);
    const now = new Date("2026-02-02T20:00:00Z");
    const candidates = detectAccomplishments(db, userId, now).filter(
      (c) => c.code === "volume_total",
    );
    expect(candidates).toHaveLength(0);
  });
});

describe("persistNewAccomplishments — lifetime totals idempotency", () => {
  it("re-running over the same workouts inserts the tier once, not per-run", () => {
    const { db, userId } = setup();
    const groupId = createGroup(db, { user_id: userId, name: "Push" }).id;
    const exId = createExercise(db, { user_id: userId, group_id: groupId, name: "Bench" }).id;
    for (let i = 0; i < 50; i++) {
      createWorkout(db, {
        user_id: userId,
        started_at: `${addDaysIso("2026-04-02", i)}T16:00:00Z`,
        rpe: 7,
        exercises: [
          {
            exercise_id: exId,
            display_order: 1,
            planned_sets: 1,
            sets: { count: 1, reps: 5, weight_kg: 60 },
          },
        ],
      });
    }
    const now = new Date(`${addDaysIso("2026-04-02", 49)}T20:00:00Z`);
    const first = persistNewAccomplishments(db, userId, now).filter(
      (c) => c.code === "workout_total",
    );
    const second = persistNewAccomplishments(db, userId, now).filter(
      (c) => c.code === "workout_total",
    );
    expect(first.find((c) => c.value === 50)).toBeDefined();
    expect(second).toHaveLength(0); // nothing new on re-run
    const stored = listRecentAccomplishments(db, userId, "2026-01-01").filter(
      (r) => r.code === "workout_total" && r.value === 50,
    );
    expect(stored).toHaveLength(1);
  });
});

describe("getRecentAccomplishments — lifetime total messages", () => {
  it("reconstructs lifetime-total messages from persisted rows", () => {
    const { db, userId } = setup();
    const today = "2026-06-08";
    insertAccomplishment(db, {
      user_id: userId,
      code: "workout_total",
      earned_on: today,
      value: 100,
      dedup_key: "100",
      details_json: "{}",
    });
    insertAccomplishment(db, {
      user_id: userId,
      code: "volume_total",
      earned_on: today,
      value: 1_000_000,
      dedup_key: "1000000",
      details_json: "{}",
    });
    insertAccomplishment(db, {
      user_id: userId,
      code: "meal_total",
      earned_on: today,
      value: 500,
      dedup_key: "500",
      details_json: "{}",
    });
    insertAccomplishment(db, {
      user_id: userId,
      code: "weigh_in_total",
      earned_on: today,
      value: 100,
      dedup_key: "100",
      details_json: "{}",
    });
    const now = new Date(`${today}T20:00:00Z`);
    const res = getRecentAccomplishments(db, userId, now);
    const byCode = Object.fromEntries(res.accomplishments.map((a) => [a.code, a.message]));
    expect(byCode.workout_total).toBe("100 workouts logged");
    expect(byCode.volume_total).toBe("1,000,000 kg lifted");
    expect(byCode.meal_total).toBe("500 meals logged");
    expect(byCode.weigh_in_total).toBe("100 weigh-ins logged");
  });
});

describe("detectAccomplishments — sleep_recovery density", () => {
  const NOW = new Date("2026-05-21T20:00:00Z"); // user-local today = 2026-05-21

  function night(db: Connection, userId: number, slept_on: string, hours: number) {
    createSleepLog(db, { user_id: userId, slept_on, hours });
  }

  it("fires when exactly 4 of the last 7 nights are >= 8h and yesterday was not met", () => {
    const { db, userId } = setup();
    night(db, userId, "2026-05-21", 8);
    night(db, userId, "2026-05-20", 8);
    night(db, userId, "2026-05-19", 8);
    night(db, userId, "2026-05-18", 8);
    night(db, userId, "2026-05-17", 6); // short
    const wins = detectAccomplishments(db, userId, NOW);
    const sr = wins.filter((w) => w.code === "sleep_recovery");
    expect(sr).toHaveLength(1);
    expect(sr[0]?.value).toBe(4);
    expect(sr[0]?.earned_on).toBe("2026-05-21");
    expect(sr[0]?.dedup_key).toBe("density:2026-05-21");
    expect(sr[0]?.details.kind).toBe("density");
  });

  it("does NOT fire at 3 of 7 good nights", () => {
    const { db, userId } = setup();
    night(db, userId, "2026-05-21", 8);
    night(db, userId, "2026-05-20", 8);
    night(db, userId, "2026-05-19", 8);
    night(db, userId, "2026-05-18", 6);
    const wins = detectAccomplishments(db, userId, NOW);
    expect(wins.filter((w) => w.code === "sleep_recovery")).toEqual([]);
  });

  it("counts a night of exactly 8h (baseline boundary is inclusive)", () => {
    const { db, userId } = setup();
    for (const d of ["2026-05-21", "2026-05-20", "2026-05-19", "2026-05-18"]) {
      night(db, userId, d, 8);
    }
    const wins = detectAccomplishments(db, userId, NOW);
    expect(wins.filter((w) => w.code === "sleep_recovery")).toHaveLength(1);
  });

  it("does NOT fire when yesterday's window was already met (edge-trigger)", () => {
    const { db, userId } = setup();
    night(db, userId, "2026-05-20", 8);
    night(db, userId, "2026-05-19", 8);
    night(db, userId, "2026-05-18", 8);
    night(db, userId, "2026-05-17", 8);
    const wins = detectAccomplishments(db, userId, NOW);
    // Today's window [05-15..05-21] has these 4 -> met. Yesterday's window
    // [05-14..05-20] has the same 4 -> also met. No transition.
    expect(wins.filter((w) => w.code === "sleep_recovery")).toEqual([]);
  });

  it("re-fires on re-entry (3 good yesterday, 4 good today)", () => {
    const { db, userId } = setup();
    // 4th good night is TODAY (05-21), out of yesterday's window [05-14..05-20],
    // so yesterday counts 3 -> not met -> transition fires.
    night(db, userId, "2026-05-21", 8);
    night(db, userId, "2026-05-20", 8);
    night(db, userId, "2026-05-19", 8);
    night(db, userId, "2026-05-18", 8);
    const wins = detectAccomplishments(db, userId, NOW);
    expect(wins.filter((w) => w.code === "sleep_recovery")).toHaveLength(1);
  });

  it("does NOT fire when no sleep has ever been logged", () => {
    const { db, userId } = setup();
    const wins = detectAccomplishments(db, userId, NOW);
    expect(wins.filter((w) => w.code === "sleep_recovery")).toEqual([]);
  });
});

describe("detectAccomplishments — sleep_recovery debt_cleared", () => {
  const NOW = new Date("2026-05-21T20:00:00Z");
  function night(db: Connection, userId: number, slept_on: string, hours: number) {
    createSleepLog(db, { user_id: userId, slept_on, hours });
  }

  it("fires when today's 7-night window has zero debt and yesterday's did not", () => {
    const { db, userId } = setup();
    // Today's window [05-15..05-21]: all logged nights >= 8h -> debt 0.
    // Yesterday's window [05-14..05-20] includes a short 05-14 night -> debt > 0.
    night(db, userId, "2026-05-14", 5); // short — only in yesterday's window
    for (const d of [
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
    ]) {
      night(db, userId, d, 8);
    }
    const wins = detectAccomplishments(db, userId, NOW);
    const debt = wins.filter(
      (w) =>
        w.code === "sleep_recovery" && (w.details as { kind?: string }).kind === "debt_cleared",
    );
    expect(debt).toHaveLength(1);
    expect(debt[0]?.dedup_key).toBe("debt:2026-05-21");
    expect(debt[0]?.value).toBe(0);
  });

  it("does NOT fire debt_cleared on an empty window (no logged nights)", () => {
    const { db, userId } = setup();
    const wins = detectAccomplishments(db, userId, NOW);
    expect(
      wins.filter(
        (w) =>
          w.code === "sleep_recovery" && (w.details as { kind?: string }).kind === "debt_cleared",
      ),
    ).toEqual([]);
  });

  it("does NOT fire debt_cleared when yesterday's window was already debt-free (edge-trigger)", () => {
    const { db, userId } = setup();
    for (const d of [
      "2026-05-14",
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
    ]) {
      night(db, userId, d, 8);
    }
    const wins = detectAccomplishments(db, userId, NOW);
    expect(
      wins.filter(
        (w) =>
          w.code === "sleep_recovery" && (w.details as { kind?: string }).kind === "debt_cleared",
      ),
    ).toEqual([]);
  });

  it("excludes untracked nights from debt so a vacation short-night doesn't block the win", () => {
    // Without untracked exclusion: the short 05-18 night is inside today's window
    // [05-15..05-21], giving today non-zero debt → win does NOT fire.
    // WITH untracked exclusion: 05-18 is skipped, today's window debt = 0.
    // The tracked short night 05-14 is only in yesterday's window [05-14..05-20],
    // so yesterday still has debt → transition fires. The result DIFFERS from the
    // no-exclusion case, making this a meaningful exercise of the exclusion path.
    const { db, userId } = setup();
    // Tracked short night — only in yesterday's window, gives yesterday debt regardless.
    night(db, userId, "2026-05-14", 5);
    // Good nights in both windows.
    for (const d of [
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
    ]) {
      night(db, userId, d, 8);
    }
    // Short night INSIDE today's window — if tracked, today would have debt and the
    // win would be blocked. Marking it untracked excludes it → today is debt-free.
    night(db, userId, "2026-05-18", 5);
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-18",
      ended_on: "2026-05-18",
      reason: "vacation",
    });
    const wins = detectAccomplishments(db, userId, NOW);
    const debt = wins.filter(
      (w) =>
        w.code === "sleep_recovery" && (w.details as { kind?: string }).kind === "debt_cleared",
    );
    expect(debt).toHaveLength(1);
    expect(debt[0]?.dedup_key).toBe("debt:2026-05-21");
  });
});

describe("sleep_recovery persistence + messageFor", () => {
  const NOW = new Date("2026-05-21T20:00:00Z");
  function night(db: Connection, userId: number, slept_on: string, hours: number) {
    createSleepLog(db, { user_id: userId, slept_on, hours });
  }

  it("persists exactly one density row on the transition day, idempotent on re-fire", () => {
    const { db, userId } = setup();
    night(db, userId, "2026-05-21", 8);
    night(db, userId, "2026-05-20", 8);
    night(db, userId, "2026-05-19", 8);
    night(db, userId, "2026-05-18", 8);
    const first = persistNewAccomplishments(db, userId, NOW).filter(
      (c) => c.code === "sleep_recovery",
    );
    expect(first).toHaveLength(1);
    expect(first[0]?.value).toBe(4); // density value = good-night count, never the 0 sentinel
    const second = persistNewAccomplishments(db, userId, NOW).filter(
      (c) => c.code === "sleep_recovery",
    );
    expect(second).toEqual([]);
    const stored = listRecentAccomplishments(db, userId, "2026-05-01").filter(
      (r) => r.code === "sleep_recovery",
    );
    expect(stored).toHaveLength(1);
  });

  it("density + debt_cleared on the same day persist as two distinct rows", () => {
    const { db, userId } = setup();
    // 05-14 short → contributes debt to yesterday's debt window [05-14..05-20]
    //              → only 3 good nights in yesterday's density window [05-14..05-20]
    // 05-18..05-21 good → today's density window [05-15..05-21] has 4 good (met)
    //                   → yesterday's density window [05-14..05-20] has 3 good (not met)
    // → density edge-trigger fires
    // Today's debt window [05-15..05-21]: 4 logged good nights → debt=0 → cleared
    // Yesterday's debt window [05-14..05-20]: 05-14 short → debt>0 → not cleared
    // → debt_cleared edge-trigger fires
    night(db, userId, "2026-05-14", 5);
    night(db, userId, "2026-05-18", 8);
    night(db, userId, "2026-05-19", 8);
    night(db, userId, "2026-05-20", 8);
    night(db, userId, "2026-05-21", 8);
    const inserted = persistNewAccomplishments(db, userId, NOW).filter(
      (c) => c.code === "sleep_recovery",
    );
    const keys = inserted.map((c) => c.dedup_key).sort();
    expect(keys).toEqual(["debt:2026-05-21", "density:2026-05-21"]);
  });

  it("getRecentAccomplishments reconstructs both messages from stored value", () => {
    const { db, userId } = setup();
    insertAccomplishment(db, {
      user_id: userId,
      code: "sleep_recovery",
      earned_on: "2026-05-21",
      value: 5,
      dedup_key: "density:2026-05-21",
      details_json: JSON.stringify({ kind: "density" }),
    });
    insertAccomplishment(db, {
      user_id: userId,
      code: "sleep_recovery",
      earned_on: "2026-05-21",
      value: 0,
      dedup_key: "debt:2026-05-21",
      details_json: JSON.stringify({ kind: "debt_cleared" }),
    });
    const res = getRecentAccomplishments(db, userId, NOW);
    const msgs = res.accomplishments
      .filter((a) => a.code === "sleep_recovery")
      .map((a) => a.message)
      .sort();
    // "5 of the last…" sorts before "Cleared…" (ASCII "5" < "C")
    expect(msgs).toEqual(["5 of the last 7 nights at 8h+", "Cleared your sleep debt"]);
  });

  it("density prior_best ignores the debt_cleared value-0 sentinel (no 'prev best 0')", () => {
    const { db, userId } = setup();
    // A debt_cleared row (value 0) and an earlier density row (value 4) exist;
    // a fresh density win (value 5) must report prev best 4 — NOT the debt row's 0.
    insertAccomplishment(db, {
      user_id: userId,
      code: "sleep_recovery",
      earned_on: "2026-05-10",
      value: 0,
      dedup_key: "debt:2026-05-10",
      details_json: JSON.stringify({ kind: "debt_cleared" }),
    });
    insertAccomplishment(db, {
      user_id: userId,
      code: "sleep_recovery",
      earned_on: "2026-05-12",
      value: 4,
      dedup_key: "density:2026-05-12",
      details_json: JSON.stringify({ kind: "density" }),
    });
    insertAccomplishment(db, {
      user_id: userId,
      code: "sleep_recovery",
      earned_on: "2026-05-20",
      value: 5,
      dedup_key: "density:2026-05-20",
      details_json: JSON.stringify({ kind: "density" }),
    });
    // Use the history read path (no recent-window floor) so all three seeded
    // rows are returned; this also exercises the shared priorBestFor helper via
    // getAccomplishmentHistory.
    const res = getAccomplishmentHistory(db, userId, NOW);
    const density5 = res.accomplishments.find((a) => a.code === "sleep_recovery" && a.value === 5);
    expect(density5?.prior_best).toEqual({ value: 4, earned_on: "2026-05-12" });

    // The debt_cleared row itself has no ordinal prior_best.
    const debt = res.accomplishments.find((a) => a.code === "sleep_recovery" && a.value === 0);
    expect(debt?.prior_best).toBeNull();

    // The lowest density win (value 4) has no lower density prior → null
    // (NOT the debt row's 0).
    const density4 = res.accomplishments.find((a) => a.code === "sleep_recovery" && a.value === 4);
    expect(density4?.prior_best).toBeNull();
  });
});
