#!/usr/bin/env node
/**
 * Seed a DB with enough simulated history to earn a broad spread of
 * accomplishment ("wins") types, for local UI / MCP testing.
 *
 * Inserts events through the repos (the real write path) and then calls
 * `persistNewAccomplishments(db, userId, asOf)` ONCE PER SIMULATED DAY, walking
 * forward in time. This is what makes edge-triggered wins (sleep_recovery) and
 * day-by-day streaks fire on their natural transition day — batch-detecting only
 * at the end would miss the transitions.
 *
 * Usage (point ALMANAC_DB_PATH at a THROWAWAY db, never real data):
 *   ALMANAC_DB_PATH=/tmp/almanac-seed.sqlite \
 *     node --import tsx/esm packages/core/src/bin/seed-accomplishments.ts [--days 110] [--email x@y.z]
 *
 * Re-running is additive for meals/workouts; weigh-ins/sleep upsert by date.
 * Best run once against a fresh db.
 */
import { seedUser } from "../bootstrap/seed-user.js";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { addDaysIso } from "../domain/user-day.js";
import { createBodyWeight } from "../repos/body-weights.repo.js";
import { createMeal } from "../repos/meals.repo.js";
import { closeAndStartPhase } from "../repos/nutrition-phases.repo.js";
import { createSleepLog } from "../repos/sleep.repo.js";
import { findUserById, updateUser } from "../repos/users.repo.js";
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

/** ISO timestamp at noon UTC for an offset (safe inside any user-day). */
function noonUtc(dateIso: string): string {
  return `${dateIso}T12:00:00Z`;
}

function main(): void {
  const dbPath = process.env.ALMANAC_DB_PATH ?? "./data/almanac.sqlite";
  if (dbPath.includes("almanac.sqlite") && !dbPath.startsWith("/tmp/")) {
    console.error(
      `Refusing to seed ${dbPath} — point ALMANAC_DB_PATH at a throwaway db (e.g. /tmp/almanac-seed.sqlite).`,
    );
    process.exit(2);
  }
  const days = Number(arg("days") ?? "110");
  const email = arg("email") ?? "you@example.com";

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
      name: email.split("@")[0] ?? "tester",
      dob: "1990-01-01",
      height_cm: 180,
      sex: "male",
    });
    userId = user_id;
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, userId);
  }
  updateUser(db, userId, { timezone: TZ });
  const user = findUserById(db, userId);
  if (!user) throw new Error("user vanished after seed");

  // Reference "today" in the user's local tz, derived from the real clock.
  const todayIso = new Date().toISOString().slice(0, 10);
  const startIso = addDaysIso(todayIso, -(days - 1));

  // Active cut phase from day 0 → enables target_adherence_streak + weight_milestone.
  // Repo shape (not the HTTP shape): deficit_kcal negative for a cut.
  closeAndStartPhase(db, {
    user_id: userId,
    name: "Seed cut",
    intent: "cut",
    phase_type: "cut",
    tdee_at_phase_start: 2600,
    tdee_source: "user_asserted",
    deficit_kcal: -500,
    daily_kcal_target: 2100,
    base_protein_g: 180,
    base_carb_g: 180,
    base_fat_g: 60,
    started_on: startIso,
  });

  console.log(`Seeding ${days} days [${startIso} … ${todayIso}] for user ${userId} (${email})`);

  const startKg = 86.0;
  for (let i = 0; i < days; i++) {
    const dateIso = addDaysIso(startIso, i);
    const sinceStart = i;

    // Weigh-in: ~0.06 kg/day downtrend → ~6.5 kg over the window (several
    // weight_milestone kg) + weigh_in_streak/total + tdee_measured.
    const kg = Number((startKg - sinceStart * 0.06).toFixed(1));
    createBodyWeight(db, { user_id: userId, measured_on: dateIso, weight_kg: kg });

    // Meal on-target (under the 2100 target band) → meal_total + adherence.
    createMeal(db, {
      user_id: userId,
      eaten_at: noonUtc(dateIso),
      name: "seed meal",
      kcal: 2050,
      protein_g: 180,
      carb_g: 180,
      fat_g: 60,
    });

    // ~4 resistance workouts/week → workout_total + workout_consistency.
    const dow = i % 7;
    if (dow === 0 || dow === 2 || dow === 4 || dow === 5) {
      createWorkout(db, {
        user_id: userId,
        started_at: noonUtc(dateIso),
        duration_min: 60,
        rpe: 8,
        est_kcal: 350,
        exercises: [],
      });
    }

    // 7 good sleep nights at the very end of the window → sleep_recovery. Logged
    // here so each night's slept_on lands on the right day; the per-day detect
    // below catches the density + debt-cleared transitions.
    if (i >= days - 7) {
      createSleepLog(db, { user_id: userId, slept_on: dateIso, hours: 8.2, quality: 4 });
    }

    // Detect AS OF this simulated day — fires streaks/edge-triggers naturally.
    persistNewAccomplishments(db, userId, new Date(noonUtc(dateIso)));
  }

  const hist = getAccomplishmentHistory(db, userId);
  const aggs = computeAccomplishmentAggregates(hist.accomplishments);
  console.log(`\nEarned ${aggs.total} wins across ${Object.keys(aggs.by_type).length} types:`);
  for (const [code, count] of Object.entries(aggs.by_type)) {
    if (count > 0) {
      const best = aggs.best_by_type[code as keyof typeof aggs.best_by_type];
      const bestStr = best ? ` (best ${best.value} on ${best.earned_on})` : "";
      console.log(`  • ${code}: ${count}${bestStr}`);
    }
  }
}

main();
