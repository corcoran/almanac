import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Connection } from "./connection.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "..", "migrations");

/**
 * Migration versions present on disk but not yet recorded in
 * `schema_migrations`, ascending. The single source of truth for
 * "is a migration pending?" — shared by runMigrations and the
 * pre-migration backup so the two cannot drift.
 */
export function pendingMigrations(db: Connection): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`);

  const applied = new Set(
    (
      db.prepare("SELECT version FROM schema_migrations").all() as Array<{
        version: number;
      }>
    ).map((r) => r.version),
  );

  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((f) => Number(f.split("_")[0]))
    .filter((version) => !applied.has(version));
}

export function runMigrations(db: Connection): number[] {
  // One directory scan → version⇒filename map. pendingMigrations() remains the
  // single source of truth for WHICH versions to apply; this just recovers each
  // one's file without re-reading the directory per migration.
  const fileByVersion = new Map<number, string>(
    readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+_.+\.sql$/.test(f))
      .map((f) => [Number(f.split("_")[0]), f] as const),
  );

  const newlyApplied: number[] = [];
  for (const version of pendingMigrations(db)) {
    const file = fileByVersion.get(version);
    if (file === undefined) continue; // unreachable in practice; satisfies the type
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(version);
    });
    tx();
    newlyApplied.push(version);
  }
  return newlyApplied;
}

export function appliedVersions(db: Connection): number[] {
  return (
    db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{
      version: number;
    }>
  ).map((r) => r.version);
}
