import type { Connection } from "../db/connection.js";

export type AccomplishmentRow = {
  id: number;
  user_id: number;
  code: string;
  earned_on: string;
  value: number;
  dedup_key: string;
  details_json: string;
  created_at: string;
};

export type InsertAccomplishmentInput = {
  user_id: number;
  code: string;
  earned_on: string;
  value: number;
  dedup_key: string;
  details_json: string;
};

const COLS = "id, user_id, code, earned_on, value, dedup_key, details_json, created_at";

/**
 * Insert a win. Returns the row, or null if it already existed (dedup on the
 * UNIQUE (user_id, code, dedup_key) constraint). Uses INSERT OR IGNORE so a
 * repeated detection is a silent no-op — the idempotency the write-hook relies on.
 * Note: on a duplicate, a differing `details_json` is NOT updated (the original
 * row is kept untouched and null is returned).
 */
export function insertAccomplishment(
  db: Connection,
  input: InsertAccomplishmentInput,
): AccomplishmentRow | null {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO accomplishments (user_id, code, earned_on, value, dedup_key, details_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.user_id,
      input.code,
      input.earned_on,
      input.value,
      input.dedup_key,
      input.details_json,
    );
  if (info.changes === 0) return null;
  const row = db
    .prepare(`SELECT ${COLS} FROM accomplishments WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as AccomplishmentRow | undefined;
  return row ?? null;
}

/** Wins earned on or after `sinceDate` (YYYY-MM-DD), newest first, scoped to the user. */
export function listRecentAccomplishments(
  db: Connection,
  userId: number,
  sinceDate: string,
): AccomplishmentRow[] {
  return db
    .prepare(
      `SELECT ${COLS} FROM accomplishments
       WHERE user_id = ? AND earned_on >= ?
       ORDER BY earned_on DESC, id DESC`,
    )
    .all(userId, sinceDate) as AccomplishmentRow[];
}

/** All wins for the user, newest first. The unbounded twin of listRecentAccomplishments. */
export function listAllAccomplishments(db: Connection, userId: number): AccomplishmentRow[] {
  return db
    .prepare(
      `SELECT ${COLS} FROM accomplishments
       WHERE user_id = ?
       ORDER BY earned_on DESC, id DESC`,
    )
    .all(userId) as AccomplishmentRow[];
}

/**
 * The best prior win of `code` for this user, strictly below `currentValue`
 * (so a freshly-earned 14-day streak finds the previous 10-day one). Highest
 * value wins, ties broken by most-recent earned_on.
 */
export function selectPriorBest(
  db: Connection,
  userId: number,
  code: string,
  currentValue: number,
): AccomplishmentRow | null {
  const row = db
    .prepare(
      `SELECT ${COLS} FROM accomplishments
       WHERE user_id = ? AND code = ? AND value < ?
       ORDER BY value DESC, earned_on DESC
       LIMIT 1`,
    )
    .get(userId, code, currentValue) as AccomplishmentRow | undefined;
  return row ?? null;
}

/**
 * The best prior strength_pr for a specific exercise (by exercise_id stored in
 * details_json), with e1RM strictly below `currentValue`. Used to scope a
 * strength PR's "previous best" to the same lift rather than across all
 * exercises. `json_extract` is available in the better-sqlite3 build.
 */
export function selectPriorBestForExercise(
  db: Connection,
  userId: number,
  exerciseId: number,
  currentValue: number,
): AccomplishmentRow | null {
  const row = db
    .prepare(
      `SELECT ${COLS} FROM accomplishments
       WHERE user_id = ?
         AND code = 'strength_pr'
         AND json_extract(details_json, '$.exercise_id') = ?
         AND value < ?
       ORDER BY value DESC, earned_on DESC
       LIMIT 1`,
    )
    .get(userId, exerciseId, currentValue) as AccomplishmentRow | undefined;
  return row ?? null;
}

/**
 * The best prior sleep_recovery DENSITY win (more good nights), strictly below
 * `currentValue`. Scoped to `details.kind = 'density'` so the debt_cleared
 * flavor — which shares the `sleep_recovery` code but stores a `value 0`
 * sentinel — never pollutes the density win's "previous best" (a plain
 * per-code `selectPriorBest` would match the debt row's 0 and render a
 * meaningless "prev best 0"). `json_extract` is available in the
 * better-sqlite3 build.
 */
export function selectPriorBestSleepDensity(
  db: Connection,
  userId: number,
  currentValue: number,
): AccomplishmentRow | null {
  const row = db
    .prepare(
      `SELECT ${COLS} FROM accomplishments
       WHERE user_id = ?
         AND code = 'sleep_recovery'
         AND json_extract(details_json, '$.kind') = 'density'
         AND value < ?
       ORDER BY value DESC, earned_on DESC
       LIMIT 1`,
    )
    .get(userId, currentValue) as AccomplishmentRow | undefined;
  return row ?? null;
}
