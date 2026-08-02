import { describe, expect, it } from "vitest";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { findDailyNet } from "../repos/daily-net.repo.js";
import { computeDayNet } from "./compute-day-net.js";

function setup() {
  const db = openDb(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO users (id, name, timezone) VALUES (1, 'Test', 'UTC')").run();
  return db;
}
const stubTdee = () => ({ kcal: 2370, basis: "measured_intake" as const });

describe("computeDayNet", () => {
  it("net = intake - tdee (deficit negative)", () => {
    const db = setup();
    db.prepare(
      "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, '2026-06-02T12:00:00Z', 1900, 0, 0, 0)",
    ).run();
    computeDayNet(db, 1, "2026-06-02", "UTC", stubTdee);
    expect(findDailyNet(db, 1, "2026-06-02")?.net_kcal).toBe(-470);
  });

  it("surplus positive", () => {
    const db = setup();
    db.prepare(
      "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, '2026-06-02T12:00:00Z', 2400, 0, 0, 0)",
    ).run();
    computeDayNet(db, 1, "2026-06-02", "UTC", stubTdee);
    expect(findDailyNet(db, 1, "2026-06-02")?.net_kcal).toBe(30);
  });

  it("zero-intake day writes no row", () => {
    const db = setup();
    computeDayNet(db, 1, "2026-06-02", "UTC", stubTdee);
    expect(findDailyNet(db, 1, "2026-06-02")).toBeNull();
  });

  it("deleting the last meal removes an existing row", () => {
    const db = setup();
    db.prepare(
      "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, '2026-06-02T12:00:00Z', 1900, 0, 0, 0)",
    ).run();
    computeDayNet(db, 1, "2026-06-02", "UTC", stubTdee); // row exists
    db.prepare("DELETE FROM meals WHERE user_id = 1").run();
    computeDayNet(db, 1, "2026-06-02", "UTC", stubTdee); // intake now 0
    expect(findDailyNet(db, 1, "2026-06-02")).toBeNull();
  });
});
