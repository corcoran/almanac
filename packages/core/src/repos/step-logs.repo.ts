import type { Connection } from "../db/connection.js";
import type { StepLog } from "../domain/body.js";
import { estimateStepsKcal } from "../signals/steps-kcal-estimate.js";

const STEP_LOG_COLUMNS = "id, user_id, on_date, steps, est_kcal, source, notes, created_at";

// on_date is the unique key; mutating it could collide. To move a step log,
// delete + re-create. Mirrors sleep.repo.
const UPDATABLE_STEP_LOG_COLUMNS = [
  "steps",
  "est_kcal",
  "notes",
] as const satisfies readonly (keyof StepLog)[];

export type CreateStepLogInput = {
  user_id: number;
  on_date: string;
  steps: number;
  /**
   * Optional override. When omitted, the repo computes a value from the
   * user's latest body weight measured on or before `on_date` (falling back
   * to the most-recent weight if none predate, then to
   * DEFAULT_STEPS_KCAL_CONFIG.fallbackWeightKg).
   */
  est_kcal?: number | null;
  source?: "manual" | "import";
  notes?: string | null;
};

export type StepLogUpdate = Partial<Pick<StepLog, (typeof UPDATABLE_STEP_LOG_COLUMNS)[number]>>;

export type ListStepLogsOptions = {
  /** Inclusive lower bound on `on_date`. YYYY-MM-DD. */
  from?: string;
  /** Exclusive upper bound on `on_date`. YYYY-MM-DD. */
  to?: string;
  /** Page size; falsy/negative → 50; clamped to 200. */
  limit?: number;
};

/**
 * Lookup the body weight to use for kcal estimation. Strategy:
 *   1. Latest row with measured_on <= on_date (so backfilling yesterday's
 *      steps uses yesterday's known weight, not today's).
 *   2. If none predate, the most recent weight at all (a freshly-bootstrapped
 *      user whose first weight log lands AFTER their first step log).
 *   3. Caller's fallback handles the no-weights-ever case.
 */
function latestWeightForDate(db: Connection, userId: number, onDate: string): number | null {
  const beforeOrOn = db
    .prepare(
      `SELECT weight_kg FROM body_weights
       WHERE user_id = ? AND measured_on <= ?
       ORDER BY measured_on DESC LIMIT 1`,
    )
    .get(userId, onDate) as { weight_kg: number } | undefined;
  if (beforeOrOn) return beforeOrOn.weight_kg;
  const anyRow = db
    .prepare(
      `SELECT weight_kg FROM body_weights
       WHERE user_id = ?
       ORDER BY measured_on DESC LIMIT 1`,
    )
    .get(userId) as { weight_kg: number } | undefined;
  return anyRow?.weight_kg ?? null;
}

/**
 * UPSERTs a step log keyed by (user_id, on_date). Returns the resulting row.
 * Computes est_kcal from the user's body weight on or before `on_date` when
 * the caller does not supply one — snapshotting at write time so reads stay
 * stable as weight changes later.
 */
export function createOrUpdateStepLog(db: Connection, input: CreateStepLogInput): StepLog {
  const est_kcal =
    input.est_kcal != null
      ? input.est_kcal
      : estimateStepsKcal({
          steps: input.steps,
          weight_kg: latestWeightForDate(db, input.user_id, input.on_date),
        });
  return db
    .prepare(
      `INSERT INTO step_logs (user_id, on_date, steps, est_kcal, source, notes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, on_date) DO UPDATE SET
         steps = excluded.steps,
         est_kcal = excluded.est_kcal,
         source = excluded.source,
         notes = excluded.notes
       RETURNING ${STEP_LOG_COLUMNS}`,
    )
    .get(
      input.user_id,
      input.on_date,
      input.steps,
      est_kcal,
      input.source ?? "manual",
      input.notes ?? null,
    ) as StepLog;
}

export function findStepLogById(db: Connection, userId: number, id: number): StepLog | null {
  const row = db
    .prepare(`SELECT ${STEP_LOG_COLUMNS} FROM step_logs WHERE id = ? AND user_id = ?`)
    .get(id, userId) as StepLog | undefined;
  return row ?? null;
}

export function findStepLogByDate(db: Connection, userId: number, onDate: string): StepLog | null {
  const row = db
    .prepare(`SELECT ${STEP_LOG_COLUMNS} FROM step_logs WHERE user_id = ? AND on_date = ?`)
    .get(userId, onDate) as StepLog | undefined;
  return row ?? null;
}

export function listStepLogs(
  db: Connection,
  userId: number,
  opts: ListStepLogsOptions = {},
): StepLog[] {
  const where: string[] = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.from !== undefined) {
    where.push("on_date >= ?");
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    where.push("on_date < ?");
    params.push(opts.to);
  }
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 200) : 50;
  return db
    .prepare(
      `SELECT ${STEP_LOG_COLUMNS}
       FROM step_logs
       WHERE ${where.join(" AND ")}
       ORDER BY on_date DESC
       LIMIT ?`,
    )
    .all(...params, limit) as StepLog[];
}

/**
 * Patches an existing step log. Unlike most repos, this one re-derives
 * `est_kcal` when the caller patches `steps` but not `est_kcal` — without
 * this, correcting a step count via the LLM would leave the kcal value
 * stale, since est_kcal is derived state, not user-supplied.
 *
 * Three cases:
 *   1. Caller patches both steps + est_kcal → both written verbatim.
 *   2. Caller patches steps alone → est_kcal re-derived using the row's on_date.
 *   3. Caller patches est_kcal alone (no steps) → est_kcal written, steps unchanged.
 */
export function updateStepLog(
  db: Connection,
  userId: number,
  id: number,
  patch: StepLogUpdate,
): StepLog | null {
  const existing = findStepLogById(db, userId, id);
  if (!existing) return null;

  const effectivePatch: StepLogUpdate = { ...patch };
  // If steps is patched but est_kcal isn't, re-derive from the row's on_date
  // so the stored kcal stays internally consistent with the steps count.
  if (effectivePatch.steps !== undefined && effectivePatch.est_kcal === undefined) {
    effectivePatch.est_kcal = estimateStepsKcal({
      steps: effectivePatch.steps,
      weight_kg: latestWeightForDate(db, existing.user_id, existing.on_date),
    });
  }

  const keys = Object.keys(effectivePatch).filter(
    (k): k is (typeof UPDATABLE_STEP_LOG_COLUMNS)[number] =>
      (UPDATABLE_STEP_LOG_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return existing;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => effectivePatch[k] ?? null);
  db.prepare(`UPDATE step_logs SET ${set} WHERE id = ? AND user_id = ?`).run(...values, id, userId);
  return findStepLogById(db, userId, id);
}

export function deleteStepLog(db: Connection, userId: number, id: number): void {
  db.prepare("DELETE FROM step_logs WHERE id = ? AND user_id = ?").run(id, userId);
}
