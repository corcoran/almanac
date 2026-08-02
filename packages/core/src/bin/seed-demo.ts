#!/usr/bin/env node
/**
 * Seed a THROWAWAY db with a full, realistic demo dataset — enough to make
 * every dashboard panel render populated (no empty states, no onboarding
 * takeover, AI surfaces unlocked). Built for UI work, screenshots, and agent
 * self-testing.
 *
 * Everything is anchored RELATIVE TO TODAY, so the data never goes stale:
 * "today" always has meals/steps/sleep, the cut phase is mid-flight, and the
 * calendar lands on the current month.
 *
 * Like seed-accomplishments.ts, this writes through the repos (the real write
 * path) and calls `persistNewAccomplishments(db, userId, asOf)` ONCE PER
 * SIMULATED DAY, walking forward in time — that's what lets edge-triggered
 * wins (sleep_recovery) and day-by-day streaks fire on their natural day
 * rather than all collapsing onto the final date.
 *
 * Usage (ALMANAC_DB_PATH must point at a throwaway db):
 *   ALMANAC_DB_PATH=/tmp/almanac-demo.sqlite \
 *     node --import tsx/esm packages/core/src/bin/seed-demo.ts [--days 40] [--email x@y.z]
 *
 * Best run once against a fresh db (meals/workouts/cardio are additive).
 */
import { seedUser } from "../bootstrap/seed-user.js";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { addDaysIso, parseLogTimestamp } from "../domain/user-day.js";
import { createBodyWeight } from "../repos/body-weights.repo.js";
import { createCardioSession } from "../repos/cardio.repo.js";
import { createGroup } from "../repos/exercise-groups.repo.js";
import { createExercise } from "../repos/exercises.repo.js";
import { createMeal } from "../repos/meals.repo.js";
import { closeAndStartPhase } from "../repos/nutrition-phases.repo.js";
import { mintToken } from "../repos/personal-access-tokens.repo.js";
import { createSleepLog } from "../repos/sleep.repo.js";
import { createOrUpdateStepLog } from "../repos/step-logs.repo.js";
import { createStoredMeal } from "../repos/stored-meals.repo.js";
import { createUntrackedPeriod } from "../repos/untracked-periods.repo.js";
import { findUserById, updateUser } from "../repos/users.repo.js";
import { createTemplate } from "../repos/workout-templates.repo.js";
import { createWorkout } from "../repos/workouts.repo.js";
import {
  computeAccomplishmentAggregates,
  getAccomplishmentHistory,
  persistNewAccomplishments,
} from "../signals/accomplishments.js";

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

const TZ = "America/Toronto";

/**
 * ISO-UTC instant for a given LOCAL wall-clock hour on `dateIso`.
 *
 * Event tables store UTC, but the UI renders in the user's timezone — so a
 * naive `${date}T08:00:00Z` would surface as 04:00 for an EDT user. Route the
 * naked wall-time through `parseLogTimestamp` (exactly what the HTTP layer does
 * for `eaten_at`/`started_at`) so seeded times read correctly in the UI and
 * land in the right user-day.
 */
function atHour(dateIso: string, hour: number): string {
  const wall = `${dateIso}T${String(hour).padStart(2, "0")}:00:00`;
  return parseLogTimestamp(wall, TZ).toISOString();
}

/**
 * Deterministic pseudo-random in [0,1) from an integer seed — keeps the demo
 * data varied (so charts look organic) but identical run-to-run.
 */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Rotating meal menu — gives the meals list and macro grid realistic variety. */
const BREAKFASTS = [
  { name: "greek yogurt + berries + granola", kcal: 320, p: 28, c: 38, f: 7 },
  { name: "3 eggs, toast, avocado", kcal: 430, p: 26, c: 30, f: 23 },
  { name: "protein oats + banana", kcal: 380, p: 30, c: 52, f: 6 },
];
const LUNCHES = [
  { name: "chicken burrito bowl", kcal: 650, p: 48, c: 70, f: 18 },
  { name: "turkey sandwich + side salad", kcal: 560, p: 42, c: 58, f: 16 },
  { name: "tuna poke bowl", kcal: 600, p: 45, c: 66, f: 15 },
];
const SNACKS = [
  { name: "protein bar", kcal: 200, p: 20, c: 18, f: 7 },
  { name: "apple + almonds", kcal: 230, p: 6, c: 28, f: 12 },
  { name: "cottage cheese + pineapple", kcal: 180, p: 22, c: 16, f: 3 },
];
const DINNERS = [
  { name: "grilled salmon, jasmine rice, broccoli", kcal: 620, p: 46, c: 58, f: 21 },
  { name: "steak, sweet potato, green beans", kcal: 680, p: 52, c: 54, f: 26 },
  { name: "chicken stir-fry with rice noodles", kcal: 590, p: 44, c: 62, f: 18 },
];

/** PPL split — mirrors the exercise groups a real user would keep. */
const EXERCISE_PLAN: Record<string, string[]> = {
  Push: [
    "Bench Press",
    "Incline DB Press",
    "Overhead Press",
    "Cable Fly",
    "Triceps Pushdown",
    "Overhead Triceps Ext",
    "Lateral Raise",
  ],
  Pull: [
    "Chest-supported Row (30 deg)",
    "Single Arm DB Row",
    "Dbl Lat Pullover",
    "Bent Over Row",
    "High Pull",
    "Bent Over Side Raise",
    "Standing Curls",
    "Hammer Curls",
    "Incline DB Curl",
  ],
  Legs: ["Back Squat", "Romanian Deadlift", "Leg Press", "Walking Lunge", "Leg Curl", "Calf Raise"],
};

/** Per-template working weights (kg) + rep targets, used to build sets. */
const LIFT_SPEC: Record<string, { reps: number; kg: number }> = {
  "Bench Press": { reps: 8, kg: 80 },
  "Incline DB Press": { reps: 10, kg: 30 },
  "Overhead Press": { reps: 8, kg: 45 },
  "Cable Fly": { reps: 12, kg: 20 },
  "Triceps Pushdown": { reps: 12, kg: 30 },
  "Overhead Triceps Ext": { reps: 12, kg: 25 },
  "Lateral Raise": { reps: 15, kg: 12 },
  "Chest-supported Row (30 deg)": { reps: 10, kg: 25 },
  "Single Arm DB Row": { reps: 12, kg: 22 },
  "Dbl Lat Pullover": { reps: 14, kg: 20 },
  "Bent Over Row": { reps: 10, kg: 60 },
  "High Pull": { reps: 8, kg: 22 },
  "Bent Over Side Raise": { reps: 12, kg: 16 },
  "Standing Curls": { reps: 10, kg: 16 },
  "Hammer Curls": { reps: 10, kg: 14 },
  "Incline DB Curl": { reps: 10, kg: 12 },
  "Back Squat": { reps: 6, kg: 100 },
  "Romanian Deadlift": { reps: 8, kg: 90 },
  "Leg Press": { reps: 12, kg: 160 },
  "Walking Lunge": { reps: 12, kg: 20 },
  "Leg Curl": { reps: 12, kg: 45 },
  "Calf Raise": { reps: 15, kg: 60 },
};

const STORED_MEALS = [
  {
    name: "Greek yogurt bowl",
    kcal: 320,
    protein_g: 28,
    carb_g: 38,
    fat_g: 7,
    description: "2% greek yogurt, blueberries, 1/4 cup granola",
  },
  {
    name: "Chicken burrito bowl",
    kcal: 650,
    protein_g: 48,
    carb_g: 70,
    fat_g: 18,
    description: "Chipotle: chicken, brown rice, black beans, salsa, no cheese",
  },
  {
    name: "Protein shake",
    kcal: 180,
    protein_g: 32,
    carb_g: 8,
    fat_g: 2,
    description: "1.5 scoops whey in water",
  },
  {
    name: "Salmon + rice + broccoli",
    kcal: 620,
    protein_g: 46,
    carb_g: 58,
    fat_g: 21,
    description: "6oz salmon, 1 cup jasmine rice, steamed broccoli",
  },
  {
    name: "Overnight oats",
    kcal: 380,
    protein_g: 30,
    carb_g: 52,
    fat_g: 6,
    description: "Oats, protein powder, chia, almond milk",
  },
];

function main(): void {
  const dbPath = process.env.ALMANAC_DB_PATH ?? "./data/almanac.sqlite";
  // Guardrail: never let this run against the real dev/prod database.
  if (dbPath.includes("almanac.sqlite") && !dbPath.startsWith("/tmp/")) {
    console.error(
      `Refusing to seed ${dbPath} — point ALMANAC_DB_PATH at a throwaway db (e.g. /tmp/almanac-demo.sqlite).`,
    );
    process.exit(2);
  }
  const days = Number(arg("days") ?? "40");
  const email = arg("email") ?? "demo@example.com";

  const db = openDb(dbPath);
  runMigrations(db);

  // Find-or-create the user (email is the natural key in the noauth/header flow).
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    | { id: number }
    | undefined;
  let userId: number;
  if (existing) {
    userId = existing.id;
  } else {
    const { user_id } = seedUser(db, {
      name: email.split("@")[0] ?? "demo",
      dob: "1982-03-14",
      height_cm: 183,
      sex: "male",
    });
    userId = user_id;
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, userId);
  }

  // A complete profile collapses the "missing field" sections in the phase
  // modal; `about_me` populates the settings field and both LLM prompts.
  updateUser(db, userId, {
    timezone: TZ,
    preferred_unit_system: "imperial",
    activity_level: "moderate",
    about_me:
      "44M, 6'0\". Training 6 days/week on a push/pull/legs split. " +
      "Cutting for the spring — trying to hold strength while the scale moves. " +
      "Bad left shoulder, so overhead pressing stays light.",
  });

  // Unlock the AI surfaces: the web UI hides both chat entry points unless
  // whoami reports llm_logging_enabled=1 (the column defaults to 0). The
  // server also needs an API key for llm_available to be true — that's an
  // env concern, handled by the launcher script, not here.
  db.prepare("UPDATE users SET llm_logging_enabled = 1 WHERE id = ?").run(userId);

  const user = findUserById(db, userId);
  if (!user) throw new Error("user vanished after seed");

  // A PAT both fills the settings TokenList and suppresses the onboarding
  // takeover that would otherwise replace the whole dashboard.
  const token = mintToken(db, { user_id: userId, name: "Demo device" });

  // Reference "today" in the user's local tz, derived from the real clock.
  const todayIso = new Date().toISOString().slice(0, 10);
  const startIso = addDaysIso(todayIso, -(days - 1));

  // Active cut phase spanning the whole window. deficit_kcal is negative for a
  // cut and must exceed 5% of TDEE (the maintenance band) or the invariant fails.
  closeAndStartPhase(db, {
    user_id: userId,
    name: "Spring cut",
    intent: "cut",
    phase_type: "cut",
    tdee_at_phase_start: 2370,
    tdee_source: "user_asserted",
    deficit_kcal: -470,
    daily_kcal_target: 1900,
    base_protein_g: 180,
    base_carb_g: 165,
    base_fat_g: 60,
    started_on: startIso,
  });

  console.log(`Seeding ${days} days [${startIso} … ${todayIso}] for user ${userId} (${email})`);

  // --- Exercise groups + exercises ------------------------------------------
  const exerciseIds = new Map<string, number>();
  let groupOrder = 0;
  for (const [groupName, lifts] of Object.entries(EXERCISE_PLAN)) {
    const group = createGroup(db, {
      user_id: userId,
      name: groupName,
      display_order: groupOrder++,
    });
    for (const lift of lifts) {
      const ex = createExercise(db, { user_id: userId, group_id: group.id, name: lift });
      exerciseIds.set(lift, ex.id);
    }
  }

  /** Resolve a lift name to its id, failing loudly rather than asserting. */
  function exerciseId(name: string): number {
    const id = exerciseIds.get(name);
    if (id === undefined) throw new Error(`unknown exercise: ${name}`);
    return id;
  }

  // --- Workout templates (one per PPL day) ----------------------------------
  const templateIds = new Map<string, number>();
  for (const [groupName, lifts] of Object.entries(EXERCISE_PLAN)) {
    const template = createTemplate(db, {
      user_id: userId,
      name: groupName.toUpperCase(),
      items: lifts.map((lift, i) => {
        const spec = LIFT_SPEC[lift];
        return {
          exercise_id: exerciseId(lift),
          display_order: i,
          default_sets: 3,
          default_reps: spec?.reps ?? 10,
          default_weight_kg: spec?.kg ?? null,
        };
      }),
    });
    templateIds.set(groupName, template.id);
  }

  // --- Stored meal library --------------------------------------------------
  for (const meal of STORED_MEALS) {
    createStoredMeal(db, { user_id: userId, ...meal });
  }

  // --- A past untracked period (fills the time-off modal) -------------------
  // Placed early in the window so it doesn't blank out the recent 7-day grid.
  createUntrackedPeriod(db, {
    user_id: userId,
    started_on: addDaysIso(startIso, 4),
    ended_on: addDaysIso(startIso, 7),
    reason: "vacation",
    notes: "Long weekend away — ate out, didn't track.",
  });
  const untrackedFrom = addDaysIso(startIso, 4);
  const untrackedTo = addDaysIso(startIso, 7);

  // --- Day-by-day walk ------------------------------------------------------
  const startKg = 78.4;
  const splitOrder = ["Push", "Pull", "Legs"];
  let workoutCount = 0;

  for (let i = 0; i < days; i++) {
    const dateIso = addDaysIso(startIso, i);
    const isUntracked = dateIso >= untrackedFrom && dateIso <= untrackedTo;

    // Weigh-in: ~0.045 kg/day downtrend with daily noise, so the trend line
    // wiggles like real scale data instead of drawing a straight ramp.
    // 14+ distinct weigh-in days is also TDEE calibration gate 1.
    const noise = (rand(i + 1) - 0.5) * 1.1;
    const kg = Number((startKg - i * 0.045 + noise).toFixed(2));
    createBodyWeight(db, { user_id: userId, measured_on: dateIso, weight_kg: kg });

    // Meals — skipped during the untracked period (that's what makes the
    // untracked-day exclusion visible in the averages).
    if (!isUntracked) {
      const pick = <T>(arr: readonly T[], salt: number): T => {
        const item = arr[Math.floor(rand(i * 7 + salt) * arr.length)];
        if (item === undefined) throw new Error("empty menu array");
        return item;
      };
      const breakfast = pick(BREAKFASTS, 1);
      const lunch = pick(LUNCHES, 2);
      const snack = pick(SNACKS, 3);
      const dinner = pick(DINNERS, 4);

      for (const [meal, hour] of [
        [breakfast, 8],
        [lunch, 13],
        [snack, 16],
        [dinner, 19],
      ] as const) {
        createMeal(db, {
          user_id: userId,
          eaten_at: atHour(dateIso, hour),
          name: meal.name,
          kcal: meal.kcal,
          protein_g: meal.p,
          carb_g: meal.c,
          fat_g: meal.f,
        });
      }
    }

    // Workouts: PPL rotation, 6 days on / 1 rest (rest on the 7th).
    const dow = i % 7;
    if (dow !== 6) {
      const splitName = splitOrder[Math.floor(dow / 2) % splitOrder.length];
      if (splitName === undefined) throw new Error("split rotation out of range");
      const lifts = EXERCISE_PLAN[splitName];
      const templateId = templateIds.get(splitName);
      if (lifts === undefined || templateId === undefined) {
        throw new Error(`missing plan for split: ${splitName}`);
      }

      createWorkout(db, {
        user_id: userId,
        template_id: templateId,
        started_at: atHour(dateIso, 17),
        duration_min: 55 + Math.floor(rand(i + 99) * 20),
        rpe: 7 + Math.round(rand(i + 51) * 2),
        est_kcal: 300 + Math.floor(rand(i + 33) * 120),
        exercises: lifts.map((lift, idx) => {
          const spec = LIFT_SPEC[lift];

          // Progression is deliberately FRONT-LOADED and then flat.
          //
          // The wins panel has no display cap — it renders every accomplishment
          // in the trailing 7-day window. A strength PR fires whenever a lift
          // beats its best e1RM, so any progression that continues to the end
          // of the window means ~every session sets PRs, and the panel grows
          // taller than the whole left column.
          //
          // Instead: gains happen over the first ~60% of the window, then
          // weights plateau. That reads as a realistic late-cut stall AND keeps
          // the recent-wins list short (a couple of PRs, not a dozen), while
          // still leaving plenty of PR history for the achievements modal.
          const growthDays = Math.floor(days * 0.6);
          const liftPhase = (idx * 3 + splitName.length) % 10;
          const steps = Math.floor(Math.min(i, growthDays) / 10);
          const progression = steps * 2.5 + (liftPhase < 5 ? 1.25 : 0);
          const baseKg = (spec?.kg ?? 20) + progression;
          return {
            exercise_id: exerciseId(lift),
            display_order: idx,
            planned_sets: 3,
            sets: { count: 3, reps: spec?.reps ?? 10, weight_kg: baseKg },
          };
        }),
      });
      workoutCount++;
    }

    // Cardio on rest days, a mid-week session, and always on the final day so
    // the movement block on "today" is never empty.
    const isToday = i === days - 1;
    if (dow === 6 || dow === 3 || isToday) {
      const durationMin = 30 + Math.floor(rand(i + 77) * 20);
      const isRun = dow === 6;
      const avgHr = isRun
        ? 142 + Math.floor(rand(i + 61) * 14)
        : 128 + Math.floor(rand(i + 61) * 12);
      createCardioSession(db, {
        user_id: userId,
        started_at: atHour(dateIso, 7),
        duration_min: durationMin,
        modality: isRun ? "run" : "bike",
        avg_hr: avgHr,
        // ~11 kcal/min running, ~8 kcal/min on the bike — keeps est_kcal within
        // 20% of the HR-derived estimate so the response has no warning flag.
        distance_km: isRun ? Number((durationMin / 6.2).toFixed(2)) : null,
        est_kcal: Math.round(durationMin * (isRun ? 11 : 8)),
      });
    }

    // Steps every day — feeds the movement block and the NET row of the grid.
    //
    // Deliberate exception: leave a step-log hole so the next-best-action engine
    // has something real to nudge about ("Log yesterday's steps"). Without a
    // genuine gap the panel collapses to a "Ready to train" one-liner and never
    // exercises its actionable layout.
    //
    // The nudge fires on the day *before* the signal's `as_of`, and `as_of` is
    // the USER-LOCAL day — which, before the 4am DAY_START_HOUR rollover, is
    // still the previous calendar date. Seeding can't know which side of the
    // rollover the UI will be opened on, so blank BOTH candidate days: one of
    // them is always "yesterday" from the engine's point of view, and the other
    // is a same-shaped hole that reads as natural either way.
    const isStepGap = i === days - 2 || i === days - 3;
    if (!isStepGap) {
      createOrUpdateStepLog(db, {
        user_id: userId,
        on_date: dateIso,
        steps: 6000 + Math.floor(rand(i + 21) * 6500),
      });
    }

    // Sleep every night, so the 7-night histogram has no ghost bars. The last
    // stretch trends good to trigger the sleep_recovery edge win.
    const goodStretch = i >= days - 8;
    const hours = goodStretch
      ? Number((7.6 + rand(i + 5) * 0.9).toFixed(1))
      : Number((6.2 + rand(i + 5) * 2.0).toFixed(1));
    createSleepLog(db, {
      user_id: userId,
      slept_on: dateIso,
      hours,
      quality: goodStretch ? 4 : 2 + Math.round(rand(i + 13) * 2),
    });

    // Detect AS OF this simulated day — fires streaks/edge-triggers naturally.
    persistNewAccomplishments(db, userId, new Date(atHour(dateIso, 12)));
  }

  const hist = getAccomplishmentHistory(db, userId);
  const aggs = computeAccomplishmentAggregates(hist.accomplishments);

  console.log(`\nSeeded:`);
  console.log(`  • ${days} weigh-ins, sleep logs, step logs`);
  console.log(`  • ${(days - 4) * 4} meals (4/day, skipping a 4-day vacation)`);
  console.log(`  • ${workoutCount} workouts across ${templateIds.size} templates`);
  console.log(`  • ${exerciseIds.size} exercises, ${STORED_MEALS.length} stored meals`);
  console.log(`  • 1 untracked period, 1 active cut phase, 1 access token`);

  console.log(`\nEarned ${aggs.total} wins across ${Object.keys(aggs.by_type).length} types:`);
  for (const [code, count] of Object.entries(aggs.by_type)) {
    if (count > 0) {
      const best = aggs.best_by_type[code as keyof typeof aggs.best_by_type];
      const bestStr = best ? ` (best ${best.value} on ${best.earned_on})` : "";
      console.log(`  • ${code}: ${count}${bestStr}`);
    }
  }

  console.log(`\nAccess token (shown once): ${token.token}`);
}

main();
