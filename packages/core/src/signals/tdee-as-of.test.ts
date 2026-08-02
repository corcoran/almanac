import { describe, expect, it } from "vitest";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { computeTdeeAsOf } from "./tdee-as-of.js";

function setup() {
  const db = openDb(":memory:");
  runMigrations(db);
  db.prepare(
    "INSERT INTO users (id, name, timezone, dob, height_cm, sex) VALUES (1, 'Test', 'UTC', '1990-01-01', 180, 'male')",
  ).run();
  return db;
}

describe("computeTdeeAsOf", () => {
  it("ignores weigh-ins and meals dated after asOf (no future leak)", () => {
    const db = setup();
    // 20 daily weights up to 2026-06-01, flat at 80kg.
    for (let i = 0; i < 20; i++) {
      const d = new Date(Date.UTC(2026, 4, 13 + i)).toISOString().slice(0, 10); // May 13..Jun 01
      db.prepare(
        "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, 80)",
      ).run(d);
    }
    // meals each day at 2000 kcal up to 2026-06-01.
    for (let i = 0; i < 20; i++) {
      const d = new Date(Date.UTC(2026, 4, 13 + i)).toISOString().slice(0, 10);
      db.prepare(
        "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, ?, 2000, 0, 0, 0)",
      ).run(`${d}T12:00:00Z`);
    }
    const before = computeTdeeAsOf(db, 1, "2026-06-01", "UTC");
    // add FUTURE weight + meal (2026-06-05) that, if leaked, would change the result.
    db.prepare(
      "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, '2026-06-05', 70)",
    ).run();
    db.prepare(
      "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, '2026-06-05T12:00:00Z', 5000, 0, 0, 0)",
    ).run();
    const after = computeTdeeAsOf(db, 1, "2026-06-01", "UTC");
    expect(after.kcal).toBe(before.kcal); // future data must NOT affect a past asOf
    // Sanity: the populated history yields a measured back-calc, not the baseline.
    expect(before.basis).toBe("measured_intake");
  });

  it("falls back to profile_baseline with fewer weigh-ins than the back-calc threshold", () => {
    const db = setup();
    // Only 5 daily weights — below the 14-day fallback threshold.
    for (let i = 0; i < 5; i++) {
      const d = new Date(Date.UTC(2026, 4, 28 + i)).toISOString().slice(0, 10); // May 28..Jun 01
      db.prepare(
        "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, 80)",
      ).run(d);
    }
    const tdee = computeTdeeAsOf(db, 1, "2026-06-01", "UTC");
    expect(tdee.basis).toBe("profile_baseline");
  });
});
