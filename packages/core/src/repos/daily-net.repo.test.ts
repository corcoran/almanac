import { expect, it } from "vitest";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import {
  deleteDailyNet,
  findDailyNet,
  getDailyNetRange,
  upsertDailyNet,
} from "./daily-net.repo.js";

function setup() {
  const db = openDb(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO users (id, name, timezone) VALUES (1, 'Test', 'America/New_York')").run();
  return db;
}

it("upsert inserts then overwrites on conflict", () => {
  const db = setup();
  upsertDailyNet(db, {
    user_id: 1,
    on_date: "2026-06-02",
    net_kcal: -470,
    intake_kcal: 1900,
    tdee_used: 2370,
    tdee_basis: "measured_intake",
  });
  expect(findDailyNet(db, 1, "2026-06-02")?.net_kcal).toBe(-470);
  upsertDailyNet(db, {
    user_id: 1,
    on_date: "2026-06-02",
    net_kcal: 30,
    intake_kcal: 2400,
    tdee_used: 2370,
    tdee_basis: "measured_intake",
  });
  const row = findDailyNet(db, 1, "2026-06-02");
  expect(row?.net_kcal).toBe(30);
  expect(row?.intake_kcal).toBe(2400);
});

it("delete removes the row; findDailyNet returns null when absent", () => {
  const db = setup();
  upsertDailyNet(db, {
    user_id: 1,
    on_date: "2026-06-02",
    net_kcal: -470,
    intake_kcal: 1900,
    tdee_used: 2370,
    tdee_basis: "measured_intake",
  });
  deleteDailyNet(db, 1, "2026-06-02");
  expect(findDailyNet(db, 1, "2026-06-02")).toBeNull();
});

it("getDailyNetRange returns rows within [from,to] inclusive", () => {
  const db = setup();
  upsertDailyNet(db, {
    user_id: 1,
    on_date: "2026-06-01",
    net_kcal: -100,
    intake_kcal: 2000,
    tdee_used: 2100,
    tdee_basis: "measured_intake",
  });
  upsertDailyNet(db, {
    user_id: 1,
    on_date: "2026-06-05",
    net_kcal: 50,
    intake_kcal: 2200,
    tdee_used: 2150,
    tdee_basis: "measured_intake",
  });
  const rows = getDailyNetRange(db, 1, "2026-06-01", "2026-06-03");
  expect(rows.map((r) => r.on_date)).toEqual(["2026-06-01"]);
});
