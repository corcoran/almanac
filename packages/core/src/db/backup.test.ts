import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupBeforeMigrations } from "./backup.js";
import { openDb } from "./connection.js";
import { pendingMigrations, runMigrations } from "./migrations.js";

const FIXED_NOW = () => new Date("2026-06-07T06:14:00.000Z");

describe("backupBeforeMigrations", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "almanac-backup-"));
    dbPath = join(dir, "almanac.sqlite");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null and writes nothing when no migrations are pending", () => {
    const db = openDb(dbPath);
    runMigrations(db); // fully migrated → nothing pending
    const result = backupBeforeMigrations(db, { dbPath, tag: "v1.2.3", now: FIXED_NOW });
    expect(result).toBeNull();
    expect(existsSync(join(dir, "backups"))).toBe(false);
  });

  it("returns null for an in-memory DB even with pending migrations", () => {
    // `:memory:` has no on-disk location to anchor a backup, and an in-memory DB
    // is ephemeral — nothing to roll back. Must no-op so the api test fleet
    // (which builds the app with dbPath ":memory:") writes no stray backups/ dir.
    const db = openDb(":memory:"); // brand-new → migrations pending
    const result = backupBeforeMigrations(db, {
      dbPath: ":memory:",
      tag: "v1.2.3",
      now: FIXED_NOW,
    });
    expect(result).toBeNull();
  });

  it("writes a timestamped, tag-named snapshot when migrations are pending", () => {
    const db = openDb(dbPath); // brand-new → all migrations pending
    const result = backupBeforeMigrations(db, { dbPath, tag: "v1.2.3", now: FIXED_NOW });
    expect(result).toBe(join(dir, "backups", "pre-v1.2.3-20260607T061400Z.sqlite"));
    expect(existsSync(result as string)).toBe(true);
  });

  it("the snapshot is a valid SQLite DB carrying the pre-migration state", () => {
    const db = openDb(dbPath);
    runMigrations(db);
    // Force a pending state by removing the highest applied version so a backup triggers.
    db.prepare(
      "DELETE FROM schema_migrations WHERE version = (SELECT MAX(version) FROM schema_migrations)",
    ).run();
    const result = backupBeforeMigrations(db, { dbPath, tag: "v1.2.3", now: FIXED_NOW });
    expect(result).not.toBeNull();
    const restored = openDb(result as string);
    const tables = restored
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .all();
    expect(tables.length).toBe(1);
  });

  it("throws when the backup cannot be written (fail-safe contract)", () => {
    const db = openDb(dbPath); // brand-new → pending migrations exist
    // Make `<dir>/backups` un-creatable: put a FILE where the parent dir would be.
    const bogusParent = join(dir, "not-a-dir");
    writeFileSync(bogusParent, "x");
    const bogusDbPath = join(bogusParent, "almanac.sqlite");
    expect(() =>
      backupBeforeMigrations(db, { dbPath: bogusDbPath, tag: "v1.2.3", now: FIXED_NOW }),
    ).toThrow();
  });

  it("leaves the live DB unchanged after taking a backup", () => {
    const db = openDb(dbPath); // brand-new → pending
    const before = pendingMigrations(db).length;
    backupBeforeMigrations(db, { dbPath, tag: "v1.2.3", now: FIXED_NOW });
    expect(pendingMigrations(db).length).toBe(before); // backup did not migrate
  });
});
