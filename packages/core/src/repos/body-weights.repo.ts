import type { Connection } from "../db/connection.js";
import type { BodyWeight } from "../domain/body.js";

const BODY_WEIGHT_COLUMNS = "id, user_id, measured_on, weight_kg, notes, created_at";

// NOTE: measured_on is deliberately NOT in the allowlist. It's the unique key
// for (user_id, measured_on); patching it could collide with another row on
// the same date. To "move" a weight reading, delete + create.
const UPDATABLE_BODY_WEIGHT_COLUMNS = [
  "weight_kg",
  "notes",
] as const satisfies readonly (keyof BodyWeight)[];

export type CreateBodyWeightInput = {
  user_id: number;
  measured_on: string;
  weight_kg: number;
  notes?: string | null;
};

export type BodyWeightUpdate = Partial<
  Pick<BodyWeight, (typeof UPDATABLE_BODY_WEIGHT_COLUMNS)[number]>
>;

export type ListBodyWeightsOptions = {
  /** Inclusive lower bound on `measured_on`. ISO 8601 date (YYYY-MM-DD). */
  from?: string;
  /**
   * Exclusive upper bound on `measured_on`. ISO 8601 date.
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
 * Upserts a body weight by `(user_id, measured_on)`. Calling twice for the
 * same user on the same day updates the existing row instead of creating a
 * second one. Returns the resulting row (always the same `id` for repeat
 * calls).
 */
export function createBodyWeight(db: Connection, input: CreateBodyWeightInput): BodyWeight {
  return db
    .prepare(
      `INSERT INTO body_weights (user_id, measured_on, weight_kg, notes)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, measured_on) DO UPDATE SET
         weight_kg = excluded.weight_kg,
         notes = excluded.notes
       RETURNING ${BODY_WEIGHT_COLUMNS}`,
    )
    .get(input.user_id, input.measured_on, input.weight_kg, input.notes ?? null) as BodyWeight;
}

export function findBodyWeightById(db: Connection, userId: number, id: number): BodyWeight | null {
  const row = db
    .prepare(`SELECT ${BODY_WEIGHT_COLUMNS} FROM body_weights WHERE id = ? AND user_id = ?`)
    .get(id, userId) as BodyWeight | undefined;
  return row ?? null;
}

/**
 * The user's most recent weight at or before `onOrBefore` (inclusive — unlike
 * `listBodyWeights`, whose `to` bound is exclusive). This is the Mifflin
 * anchor for cold-start TDEE: pass user-local today so a weigh-in logged
 * minutes ago still counts, while future-dated rows never do.
 */
export function findLatestWeightKgUpTo(
  db: Connection,
  userId: number,
  onOrBefore: string,
): number | null {
  const row = db
    .prepare(
      `SELECT weight_kg FROM body_weights
       WHERE user_id = ? AND measured_on <= ?
       ORDER BY measured_on DESC LIMIT 1`,
    )
    .get(userId, onOrBefore) as { weight_kg: number } | undefined;
  return row?.weight_kg ?? null;
}

export function listBodyWeights(
  db: Connection,
  userId: number,
  opts: ListBodyWeightsOptions = {},
): BodyWeight[] {
  const where: string[] = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.from !== undefined) {
    where.push("measured_on >= ?");
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    where.push("measured_on < ?");
    params.push(opts.to);
  }
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 200) : 50;
  return db
    .prepare(
      `SELECT ${BODY_WEIGHT_COLUMNS}
       FROM body_weights
       WHERE ${where.join(" AND ")}
       ORDER BY measured_on DESC
       LIMIT ?`,
    )
    .all(...params, limit) as BodyWeight[];
}

export function updateBodyWeight(
  db: Connection,
  userId: number,
  id: number,
  patch: BodyWeightUpdate,
): BodyWeight | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_BODY_WEIGHT_COLUMNS)[number] =>
    (UPDATABLE_BODY_WEIGHT_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findBodyWeightById(db, userId, id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE body_weights SET ${set} WHERE id = ? AND user_id = ?`).run(
    ...values,
    id,
    userId,
  );
  return findBodyWeightById(db, userId, id);
}

export function deleteBodyWeight(db: Connection, userId: number, id: number): void {
  db.prepare("DELETE FROM body_weights WHERE id = ? AND user_id = ?").run(id, userId);
}
