import type { Connection } from "../db/connection.js";
import type { Exercise } from "../domain/training.js";

const EXERCISE_COLUMNS = "id, user_id, group_id, name, notes, archived_at, created_at";

const UPDATABLE_EXERCISE_COLUMNS = [
  "name",
  "group_id",
  "notes",
] as const satisfies readonly (keyof Exercise)[];

export type CreateExerciseInput = {
  user_id: number;
  group_id: number;
  name: string;
  notes?: string | null;
};

export type ExerciseUpdate = Partial<Pick<Exercise, (typeof UPDATABLE_EXERCISE_COLUMNS)[number]>>;

export type ListExercisesOptions = {
  groupId?: number;
  includeArchived?: boolean;
};

export function createExercise(db: Connection, input: CreateExerciseInput): Exercise {
  return db
    .prepare(
      `INSERT INTO exercises (user_id, group_id, name, notes)
       VALUES (?, ?, ?, ?)
       RETURNING ${EXERCISE_COLUMNS}`,
    )
    .get(input.user_id, input.group_id, input.name, input.notes ?? null) as Exercise;
}

/**
 * Returns the exercise row regardless of archive state — historical workouts
 * reference soft-deleted exercises and must be able to resolve them. Use
 * `listExercises` with default options to get only active rows.
 */
export function findExerciseById(db: Connection, userId: number, id: number): Exercise | null {
  const row = db
    .prepare(`SELECT ${EXERCISE_COLUMNS} FROM exercises WHERE id = ? AND user_id = ?`)
    .get(id, userId) as Exercise | undefined;
  return row ?? null;
}

export function listExercises(
  db: Connection,
  userId: number,
  opts: ListExercisesOptions = {},
): Exercise[] {
  const where: string[] = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.groupId !== undefined) {
    where.push("group_id = ?");
    params.push(opts.groupId);
  }
  if (!opts.includeArchived) {
    where.push("archived_at IS NULL");
  }
  return db
    .prepare(
      `SELECT ${EXERCISE_COLUMNS}
       FROM exercises
       WHERE ${where.join(" AND ")}
       ORDER BY name`,
    )
    .all(...params) as Exercise[];
}

export function updateExercise(
  db: Connection,
  userId: number,
  id: number,
  patch: ExerciseUpdate,
): Exercise | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_EXERCISE_COLUMNS)[number] =>
    (UPDATABLE_EXERCISE_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findExerciseById(db, userId, id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE exercises SET ${set} WHERE id = ? AND user_id = ?`).run(...values, id, userId);
  return findExerciseById(db, userId, id);
}

/**
 * Sets `archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`. No-op (no error)
 * if `id` does not exist. Archived rows remain findable by id but are
 * excluded from default `listExercises` results.
 */
export function archiveExercise(db: Connection, userId: number, id: number): void {
  db.prepare(
    "UPDATE exercises SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?",
  ).run(id, userId);
}

/**
 * Clears `archived_at`. No-op (no error) if `id` does not exist or if the row
 * was not archived. The partial UNIQUE index on `(user_id, name) WHERE archived_at IS NULL`
 * will throw if unarchiving would collide with an active row of the same name.
 */
export function unarchiveExercise(db: Connection, userId: number, id: number): void {
  db.prepare("UPDATE exercises SET archived_at = NULL WHERE id = ? AND user_id = ?").run(
    id,
    userId,
  );
}
