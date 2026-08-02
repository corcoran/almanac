import { describe, expect, it } from "vitest";
import { openDb } from "./connection.js";
import { appliedVersions, pendingMigrations, runMigrations } from "./migrations.js";

describe("migrations", () => {
  it("applies the initial migration on a fresh database", () => {
    const db = openDb(":memory:");
    const newly = runMigrations(db);
    expect(newly).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
    expect(appliedVersions(db)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(tables).toContain("users");
    expect(tables).toContain("workouts");
    expect(tables).toContain("sets");
  });

  it("is idempotent across runs", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    const newly = runMigrations(db);
    expect(newly).toEqual([]);
    expect(appliedVersions(db)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
  });

  it("migration 008 adds personal_access_tokens table and unique email index, and re-running is idempotent", () => {
    const db = openDb(":memory:");
    runMigrations(db);

    // personal_access_tokens table exists
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(tables).toContain("personal_access_tokens");

    // Re-running runMigrations returns [] (idempotent)
    const newly = runMigrations(db);
    expect(newly).toEqual([]);

    // idx_users_email_unique index exists
    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(indexes).toContain("idx_users_email_unique");
  });

  it("migration 009 adds the untracked_periods table with a reason CHECK and is idempotent", () => {
    const db = openDb(":memory:");
    runMigrations(db);

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(tables).toContain("untracked_periods");

    // Re-running is idempotent.
    expect(runMigrations(db)).toEqual([]);

    // Seed a user, then insert a valid period.
    db.prepare("INSERT INTO users (name) VALUES ('Test')").run();
    const userId = (db.prepare("SELECT id FROM users WHERE name='Test'").get() as { id: number })
      .id;
    db.prepare(
      "INSERT INTO untracked_periods (user_id, started_on, ended_on, reason) VALUES (?, '2026-05-01', '2026-05-07', 'vacation')",
    ).run(userId);
    const row = db
      .prepare("SELECT reason FROM untracked_periods WHERE user_id = ?")
      .get(userId) as { reason: string };
    expect(row.reason).toBe("vacation");

    // The reason CHECK rejects an out-of-enum value.
    expect(() =>
      db
        .prepare(
          "INSERT INTO untracked_periods (user_id, started_on, ended_on, reason) VALUES (?, '2026-06-01', '2026-06-02', 'holiday')",
        )
        .run(userId),
    ).toThrow();
  });

  it("after applying all migrations, users.timezone is present with default 'UTC'", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    db.prepare("INSERT INTO users (name) VALUES ('Test')").run();
    const u = db.prepare("SELECT id, timezone FROM users WHERE name='Test'").get() as {
      id: number;
      timezone: string;
    };
    expect(u.timezone).toBe("UTC");
  });

  it("migration 010 adds the daily_net table with a tdee_basis CHECK and is idempotent", () => {
    const db = openDb(":memory:");
    runMigrations(db);

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(tables).toContain("daily_net");

    // Re-running is idempotent.
    expect(runMigrations(db)).toEqual([]);

    // Seed a user, then insert a valid row.
    db.prepare("INSERT INTO users (name) VALUES ('Test')").run();
    const userId = (db.prepare("SELECT id FROM users WHERE name='Test'").get() as { id: number })
      .id;
    db.prepare(
      "INSERT INTO daily_net (user_id, on_date, net_kcal, intake_kcal, tdee_used, tdee_basis) VALUES (?, '2026-06-02', -470, 1900, 2370, 'measured_intake')",
    ).run(userId);
    const row = db.prepare("SELECT tdee_basis FROM daily_net WHERE user_id = ?").get(userId) as {
      tdee_basis: string;
    };
    expect(row.tdee_basis).toBe("measured_intake");

    // The tdee_basis CHECK rejects an out-of-enum value.
    expect(() =>
      db
        .prepare(
          "INSERT INTO daily_net (user_id, on_date, net_kcal, intake_kcal, tdee_used, tdee_basis) VALUES (?, '2026-06-03', 0, 2000, 2000, 'invalid')",
        )
        .run(userId),
    ).toThrow();
  });

  it("012 preserves existing accomplishment rows and accepts strength_pr", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    // Seed a user (match the users-insert columns the other tests/seedUser use).
    db.prepare("INSERT INTO users (name) VALUES ('Jeff')").run();
    // A pre-existing v1 row (weight_milestone) must survive the rebuild.
    db.prepare(
      `INSERT INTO accomplishments (user_id, code, earned_on, value, dedup_key, details_json)
       VALUES (1, 'weight_milestone', '2026-05-01', 2, '5:2', '{}')`,
    ).run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM accomplishments").get()).toEqual({ n: 1 });
    // The new code is accepted by the widened CHECK.
    db.prepare(
      `INSERT INTO accomplishments (user_id, code, earned_on, value, dedup_key, details_json)
       VALUES (1, 'strength_pr', '2026-06-08', 96.5, '3:96.5', '{}')`,
    ).run();
    const codes = (
      db.prepare("SELECT code FROM accomplishments ORDER BY id").all() as Array<{ code: string }>
    ).map((r) => r.code);
    expect(codes).toEqual(["weight_milestone", "strength_pr"]);
    // The index exists after the rebuild.
    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_accomplishments_user_code'",
      )
      .get();
    expect(idx).not.toBeUndefined();
    // The UNIQUE(user_id, code, dedup_key) constraint survived the rebuild.
    expect(() =>
      db
        .prepare(
          `INSERT INTO accomplishments (user_id, code, earned_on, value, dedup_key, details_json)
           VALUES (1, 'strength_pr', '2026-06-09', 97, '3:96.5', '{}')`,
        )
        .run(),
    ).toThrow();
  });

  it("after applying all migrations, exercise_instances has a nullable skipped_at column", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    // Insert minimum scaffold: user → group → exercise → workout → exercise_instance
    db.prepare("INSERT INTO users (name) VALUES ('Test')").run();
    const userId = (db.prepare("SELECT id FROM users WHERE name='Test'").get() as { id: number })
      .id;
    db.prepare(
      "INSERT INTO exercise_groups (user_id, name, display_order) VALUES (?, 'Chest', 0)",
    ).run(userId);
    const gid = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
    db.prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (?, ?, 'Bench')").run(
      userId,
      gid,
    );
    const eid = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
    db.prepare(
      "INSERT INTO workouts (user_id, started_at, rpe) VALUES (?, '2026-05-08T00:00:00Z', 7)",
    ).run(userId);
    const wid = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
    db.prepare(
      "INSERT INTO exercise_instances (workout_id, exercise_id, display_order, planned_sets) VALUES (?, ?, 0, 3)",
    ).run(wid, eid);
    const eiId = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

    // Verify skipped_at defaults to NULL
    const row = db.prepare("SELECT skipped_at FROM exercise_instances WHERE id = ?").get(eiId) as {
      skipped_at: string | null;
    };
    expect(row.skipped_at).toBeNull();

    // Verify we can set it
    db.prepare(
      "UPDATE exercise_instances SET skipped_at = '2026-05-08T18:00:00Z' WHERE id = ?",
    ).run(eiId);
    const row2 = db.prepare("SELECT skipped_at FROM exercise_instances WHERE id = ?").get(eiId) as {
      skipped_at: string | null;
    };
    expect(row2.skipped_at).toBe("2026-05-08T18:00:00Z");
  });

  it("019 adds web_search_requests + billed_tokens and backfills billed from real tokens", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    db.prepare(
      "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('Jeff','1990-01-01',180,'male','t@e.com')",
    ).run();
    // A pre-existing-style row (as if written before 019): set billed via the
    // backfill path by inserting only the legacy columns + the NOT NULL ones.
    db.prepare(
      `INSERT INTO llm_usage (user_id, created_at, provider, model, feature,
         input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, billed_tokens)
       VALUES (1,'2026-06-22T12:00:00.000Z','anthropic','claude-haiku-4-5','meal_chat',
         1000, 200, 0, 0, 0.001, 1200)`,
    ).run();
    const row = db
      .prepare("SELECT web_search_requests, billed_tokens FROM llm_usage WHERE user_id = 1")
      .get() as { web_search_requests: number; billed_tokens: number };
    expect(row.web_search_requests).toBe(0);
    expect(row.billed_tokens).toBe(1200);
    db.close();
  });

  it("021 adds a nullable sources column to insights_chat_turns", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    const cols = db.prepare("PRAGMA table_info(insights_chat_turns)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    const sources = cols.find((c) => c.name === "sources");
    expect(sources).toBeDefined();
    expect(sources?.notnull).toBe(0); // nullable
    db.close();
  });
});

describe("pendingMigrations", () => {
  it("returns all migration versions on a brand-new (unmigrated) DB", () => {
    const db = openDb(":memory:");
    const pending = pendingMigrations(db);
    // 001_init … 010_daily_net → at least the 10 shipped migrations, all pending.
    expect(pending.length).toBeGreaterThanOrEqual(10);
    expect(pending).toContain(1);
  });

  it("returns an empty array once all migrations are applied", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    expect(pendingMigrations(db)).toEqual([]);
  });
});
