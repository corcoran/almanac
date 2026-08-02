import { expect, it } from "vitest";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { findDailyNet } from "../repos/daily-net.repo.js";
import { backfillDailyNet } from "./backfill-daily-net.js";

function setup() {
  const db = openDb(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO users (id, name, timezone) VALUES (1, 'Test', 'UTC')").run();
  return db;
}

it("backfills a snapshot for each distinct user-local day with intake, skips gap days", () => {
  const db = setup();
  // meals on 3 distinct days (UTC), and a gap day (2026-06-03) with no meals.
  db.prepare(
    "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, '2026-06-01T12:00:00Z', 2000, 0, 0, 0)",
  ).run();
  db.prepare(
    "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, '2026-06-02T12:00:00Z', 1900, 0, 0, 0)",
  ).run();
  db.prepare(
    "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, '2026-06-04T12:00:00Z', 2200, 0, 0, 0)",
  ).run();
  backfillDailyNet(db);
  expect(findDailyNet(db, 1, "2026-06-01")).not.toBeNull();
  expect(findDailyNet(db, 1, "2026-06-02")).not.toBeNull();
  expect(findDailyNet(db, 1, "2026-06-04")).not.toBeNull();
  expect(findDailyNet(db, 1, "2026-06-03")).toBeNull(); // gap day, no intake
});

it("is idempotent — re-running yields identical rows", () => {
  const db = setup();
  db.prepare(
    "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, '2026-06-01T12:00:00Z', 2000, 0, 0, 0)",
  ).run();
  backfillDailyNet(db);
  const first = findDailyNet(db, 1, "2026-06-01");
  backfillDailyNet(db);
  const second = findDailyNet(db, 1, "2026-06-01");
  expect(second?.net_kcal).toBe(first?.net_kcal);
  expect(second?.intake_kcal).toBe(first?.intake_kcal);
  expect(second?.tdee_used).toBe(first?.tdee_used);
});

it("backfills an alcohol-only day", () => {
  const db = setup();
  db.prepare(
    "INSERT INTO alcohol_sessions (user_id, started_at, est_kcal, drinks_count) VALUES (1, '2026-06-05T21:00:00Z', 400, 2)",
  ).run();
  backfillDailyNet(db);
  expect(findDailyNet(db, 1, "2026-06-05")).not.toBeNull();
});

it("returns correct user and day counts", () => {
  const db = setup();
  db.prepare(
    "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, '2026-06-01T12:00:00Z', 2000, 0, 0, 0)",
  ).run();
  db.prepare(
    "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, '2026-06-02T12:00:00Z', 1900, 0, 0, 0)",
  ).run();
  const result = backfillDailyNet(db);
  expect(result.users).toBe(1);
  expect(result.days).toBe(2);
});
