import type { Connection } from "../db/connection.js";
import type { UntrackedPeriod, UntrackedReason } from "../domain/untracked-periods.js";

const PERIOD_COLUMNS = "id, user_id, started_on, ended_on, reason, notes, created_at";

export type CreateUntrackedPeriodInput = {
  user_id: number;
  started_on: string;
  ended_on: string;
  reason: UntrackedReason;
  notes?: string | null;
};

export type ListUntrackedPeriodsOptions = {
  /** Inclusive lower bound — keep periods that END on/after this date. */
  from?: string;
  /** Inclusive upper bound — keep periods that START on/before this date. */
  to?: string;
};

/** Insert a period and return the stored row. Overlap is validated at the
 *  route layer — the repo trusts its caller. */
export function createUntrackedPeriod(
  db: Connection,
  input: CreateUntrackedPeriodInput,
): UntrackedPeriod {
  return db
    .prepare(
      `INSERT INTO untracked_periods (user_id, started_on, ended_on, reason, notes)
       VALUES (?, ?, ?, ?, ?)
       RETURNING ${PERIOD_COLUMNS}`,
    )
    .get(
      input.user_id,
      input.started_on,
      input.ended_on,
      input.reason,
      input.notes ?? null,
    ) as UntrackedPeriod;
}

export function findUntrackedPeriodById(db: Connection, id: number): UntrackedPeriod | null {
  const row = db.prepare(`SELECT ${PERIOD_COLUMNS} FROM untracked_periods WHERE id = ?`).get(id) as
    | UntrackedPeriod
    | undefined;
  return row ?? null;
}

/**
 * Periods overlapping the (inclusive) `[from, to]` window, newest first.
 * Overlap test: a period is in range unless it ends before `from` or starts
 * after `to`. Either bound is optional.
 */
export function listUntrackedPeriods(
  db: Connection,
  userId: number,
  opts: ListUntrackedPeriodsOptions = {},
): UntrackedPeriod[] {
  const where: string[] = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.from !== undefined) {
    where.push("ended_on >= ?");
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    where.push("started_on <= ?");
    params.push(opts.to);
  }
  return db
    .prepare(
      `SELECT ${PERIOD_COLUMNS}
       FROM untracked_periods
       WHERE ${where.join(" AND ")}
       ORDER BY started_on DESC`,
    )
    .all(...params) as UntrackedPeriod[];
}

export function deleteUntrackedPeriod(db: Connection, userId: number, id: number): void {
  db.prepare("DELETE FROM untracked_periods WHERE user_id = ? AND id = ?").run(userId, id);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Expand every period overlapping `[fromDate, toDate]` (inclusive) into a flat
 * set of YYYY-MM-DD strings, each day clipped to the query range. Overlapping
 * periods collapse naturally because a Set dedupes. This is the workhorse the
 * TDEE signal consumes — `untrackedDays.has(date)` is the exclusion test.
 */
export function getUntrackedDays(
  db: Connection,
  userId: number,
  fromDate: string,
  toDate: string,
): Set<string> {
  const periods = listUntrackedPeriods(db, userId, { from: fromDate, to: toDate });
  const days = new Set<string>();
  for (const p of periods) {
    // Clip the period to the query window.
    const start = p.started_on < fromDate ? fromDate : p.started_on;
    const end = p.ended_on > toDate ? toDate : p.ended_on;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      days.add(d);
    }
  }
  return days;
}
