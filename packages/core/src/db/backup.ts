import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Connection } from "./connection.js";
import { pendingMigrations } from "./migrations.js";

export type BackupOptions = {
  /** Absolute path to the live SQLite DB (its directory anchors backups/). */
  dbPath: string;
  /** Release tag baked into the image (e.g. "v1.2.3"); part of the filename. */
  tag: string;
  /** Injectable clock for deterministic filenames in tests. */
  now?: () => Date;
};

/** Compact UTC stamp: 2026-06-07T06:14:00.000Z → "20260607T061400Z". */
function stamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Snapshot the DB to `<dbDir>/backups/pre-<tag>-<timestamp>.sqlite` IFF there are
 * pending migrations. Returns the backup path, or null when nothing is pending
 * (a plain restart with no schema change writes no backup) or the DB is
 * in-memory (nothing to roll back).
 *
 * Synchronous on purpose: it runs at startup before the server accepts traffic,
 * so there are no concurrent writers and `db.serialize()` yields a consistent
 * point-in-time image. Throws on any failure (mkdir/serialize/write) so the
 * caller can abort startup — never migrate without a rollback point.
 */
export function backupBeforeMigrations(db: Connection, opts: BackupOptions): string | null {
  // In-memory DBs have no on-disk location to back up and are ephemeral by
  // nature. No-op keeps the api test fleet (dbPath ":memory:") from writing a
  // stray backups/ dir.
  if (opts.dbPath === ":memory:") return null;
  if (pendingMigrations(db).length === 0) return null;

  const backupDir = join(dirname(opts.dbPath), "backups");
  mkdirSync(backupDir, { recursive: true });

  const when = (opts.now ?? (() => new Date()))();
  const path = join(backupDir, `pre-${opts.tag}-${stamp(when)}.sqlite`);

  const buf = db.serialize();
  writeFileSync(path, buf);
  return path;
}
