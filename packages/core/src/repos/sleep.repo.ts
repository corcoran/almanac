import type { Connection } from "../db/connection.js";
import type { SleepLog } from "../domain/body.js";

const SLEEP_COLUMNS = "id, user_id, slept_on, hours, quality, notes, created_at";

// NOTE: slept_on is deliberately NOT in the allowlist. It's the unique key
// for (user_id, slept_on); patching it could collide with another row on
// the same date. To "move" a sleep log, delete + create.
const UPDATABLE_SLEEP_COLUMNS = [
  "hours",
  "quality",
  "notes",
] as const satisfies readonly (keyof SleepLog)[];

export type CreateSleepInput = {
  user_id: number;
  slept_on: string;
  hours: number;
  quality?: number | null;
  notes?: string | null;
};

export type SleepLogUpdate = Partial<Pick<SleepLog, (typeof UPDATABLE_SLEEP_COLUMNS)[number]>>;

export type ListSleepLogsOptions = {
  /** Inclusive lower bound on `slept_on`. ISO 8601 date (YYYY-MM-DD). */
  from?: string;
  /**
   * Exclusive upper bound on `slept_on`. ISO 8601 date.
   * Matches the spec §6.1 `?before=<iso>` cursor convention.
   */
  to?: string;
  /**
   * Page size. Falsy or negative values fall back to the default (50).
   * Hard-capped at 200; values above 200 silently clamp.
   */
  limit?: number;
};

/**
 * Upserts a sleep log by `(user_id, slept_on)`. Calling twice for the
 * same user on the same night updates the existing row (hours, quality,
 * and notes) instead of creating a second one. Returns the resulting row
 * (always the same `id` for repeat calls).
 */
export function createSleepLog(db: Connection, input: CreateSleepInput): SleepLog {
  return db
    .prepare(
      `INSERT INTO sleep_logs (user_id, slept_on, hours, quality, notes)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, slept_on) DO UPDATE SET
         hours = excluded.hours,
         quality = excluded.quality,
         notes = excluded.notes
       RETURNING ${SLEEP_COLUMNS}`,
    )
    .get(
      input.user_id,
      input.slept_on,
      input.hours,
      input.quality ?? null,
      input.notes ?? null,
    ) as SleepLog;
}

export function findSleepLogById(db: Connection, userId: number, id: number): SleepLog | null {
  const row = db
    .prepare(`SELECT ${SLEEP_COLUMNS} FROM sleep_logs WHERE id = ? AND user_id = ?`)
    .get(id, userId) as SleepLog | undefined;
  return row ?? null;
}

export function listSleepLogs(
  db: Connection,
  userId: number,
  opts: ListSleepLogsOptions = {},
): SleepLog[] {
  const where: string[] = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.from !== undefined) {
    where.push("slept_on >= ?");
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    where.push("slept_on < ?");
    params.push(opts.to);
  }
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 200) : 50;
  return db
    .prepare(
      `SELECT ${SLEEP_COLUMNS}
       FROM sleep_logs
       WHERE ${where.join(" AND ")}
       ORDER BY slept_on DESC
       LIMIT ?`,
    )
    .all(...params, limit) as SleepLog[];
}

export function updateSleepLog(
  db: Connection,
  userId: number,
  id: number,
  patch: SleepLogUpdate,
): SleepLog | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_SLEEP_COLUMNS)[number] =>
    (UPDATABLE_SLEEP_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findSleepLogById(db, userId, id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE sleep_logs SET ${set} WHERE id = ? AND user_id = ?`).run(
    ...values,
    id,
    userId,
  );
  return findSleepLogById(db, userId, id);
}

export function deleteSleepLog(db: Connection, userId: number, id: number): void {
  db.prepare("DELETE FROM sleep_logs WHERE id = ? AND user_id = ?").run(id, userId);
}
