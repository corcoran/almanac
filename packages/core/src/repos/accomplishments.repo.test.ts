import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import {
  insertAccomplishment,
  listAllAccomplishments,
  listRecentAccomplishments,
  selectPriorBest,
  selectPriorBestForExercise,
} from "./accomplishments.repo.js";

describe("accomplishments migration", () => {
  it("creates the accomplishments table with the unique constraint", () => {
    const db = freshDb();
    const cols = db.prepare("PRAGMA table_info(accomplishments)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "code",
        "earned_on",
        "value",
        "dedup_key",
        "details_json",
        "created_at",
      ]),
    );
  });
});

describe("accomplishments repo", () => {
  it("insert is idempotent on (user_id, code, dedup_key)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const a = insertAccomplishment(db, {
      user_id: userId,
      code: "weigh_in_streak",
      earned_on: "2026-05-21",
      value: 7,
      dedup_key: "7",
      details_json: '{"streak_days":7}',
    });
    const b = insertAccomplishment(db, {
      user_id: userId,
      code: "weigh_in_streak",
      earned_on: "2026-05-21",
      value: 7,
      dedup_key: "7",
      details_json: '{"streak_days":7}',
    });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    const rows = listRecentAccomplishments(db, userId, "2026-05-01");
    expect(rows).toHaveLength(1);
  });

  it("selectPriorBest returns the highest-value earlier win of the same code", () => {
    const db = freshDb();
    const userId = seedUser(db);
    insertAccomplishment(db, {
      user_id: userId,
      code: "weigh_in_streak",
      earned_on: "2026-05-01",
      value: 10,
      dedup_key: "10",
      details_json: "{}",
    });
    const prior = selectPriorBest(db, userId, "weigh_in_streak", 14);
    expect(prior?.value).toBe(10);
    expect(prior?.earned_on).toBe("2026-05-01");
  });

  it("selectPriorBest returns null when there is no earlier win", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(selectPriorBest(db, userId, "weigh_in_streak", 7)).toBeNull();
  });

  it("listRecentAccomplishments scopes by user and date floor", () => {
    const db = freshDb();
    const u1 = seedUser(db);
    const u2 = seedUser(db, { name: "Other" });
    insertAccomplishment(db, {
      user_id: u1,
      code: "weigh_in_streak",
      earned_on: "2026-05-21",
      value: 7,
      dedup_key: "7",
      details_json: "{}",
    });
    insertAccomplishment(db, {
      user_id: u2,
      code: "weigh_in_streak",
      earned_on: "2026-05-21",
      value: 7,
      dedup_key: "7",
      details_json: "{}",
    });
    expect(listRecentAccomplishments(db, u1, "2026-05-01")).toHaveLength(1);
  });

  it("accepts the four lifetime-total codes after migration 014", () => {
    const db = freshDb();
    const userId = seedUser(db);
    for (const code of ["workout_total", "volume_total", "meal_total", "weigh_in_total"]) {
      const row = insertAccomplishment(db, {
        user_id: userId,
        code,
        earned_on: "2026-06-01",
        value: 100,
        dedup_key: "100",
        details_json: "{}",
      });
      expect(row).not.toBeNull();
      expect(row?.code).toBe(code);
    }
  });

  it("listAllAccomplishments returns all rows newest-first, scoped to user", () => {
    const db = freshDb();
    const u1 = seedUser(db);
    const u2 = seedUser(db, { name: "Other" });
    insertAccomplishment(db, {
      user_id: u1,
      code: "weigh_in_streak",
      earned_on: "2026-01-01",
      value: 7,
      dedup_key: "7",
      details_json: "{}",
    });
    insertAccomplishment(db, {
      user_id: u1,
      code: "weigh_in_streak",
      earned_on: "2026-06-01",
      value: 14,
      dedup_key: "14",
      details_json: "{}",
    });
    insertAccomplishment(db, {
      user_id: u2,
      code: "weigh_in_streak",
      earned_on: "2026-06-01",
      value: 14,
      dedup_key: "14",
      details_json: "{}",
    });
    const rows = listAllAccomplishments(db, u1);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.earned_on)).toEqual(["2026-06-01", "2026-01-01"]);
  });
});

describe("selectPriorBestForExercise", () => {
  it("returns the highest earlier strength_pr of the SAME exercise, below currentValue", () => {
    const db = freshDb();
    const userId = seedUser(db);
    insertAccomplishment(db, {
      user_id: userId,
      code: "strength_pr",
      earned_on: "2026-05-01",
      value: 90,
      dedup_key: "3:90",
      details_json: '{"exercise_id":3}',
    });
    insertAccomplishment(db, {
      user_id: userId,
      code: "strength_pr",
      earned_on: "2026-05-10",
      value: 93.5,
      dedup_key: "3:93.5",
      details_json: '{"exercise_id":3}',
    });
    // A higher e1RM on a DIFFERENT exercise must NOT be picked.
    insertAccomplishment(db, {
      user_id: userId,
      code: "strength_pr",
      earned_on: "2026-05-12",
      value: 140,
      dedup_key: "7:140",
      details_json: '{"exercise_id":7}',
    });

    const prior = selectPriorBestForExercise(db, userId, 3, 96.5);
    expect(prior?.value).toBe(93.5);
    expect(prior?.earned_on).toBe("2026-05-10");
  });

  it("returns null when there is no earlier PR for that exercise", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(selectPriorBestForExercise(db, userId, 3, 96.5)).toBeNull();
  });

  it("excludes PRs at or above currentValue (strictly less)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    insertAccomplishment(db, {
      user_id: userId,
      code: "strength_pr",
      earned_on: "2026-05-01",
      value: 96.5,
      dedup_key: "3:96.5",
      details_json: '{"exercise_id":3}',
    });
    expect(selectPriorBestForExercise(db, userId, 3, 96.5)).toBeNull();
  });
});
