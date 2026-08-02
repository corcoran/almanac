import type { Connection } from "../db/connection.js";
import type { ExerciseGroup } from "../domain/training.js";

const GROUP_COLUMNS = "id, user_id, name, display_order, created_at";

const UPDATABLE_GROUP_COLUMNS = [
  "name",
  "display_order",
] as const satisfies readonly (keyof ExerciseGroup)[];

export type CreateGroupInput = {
  user_id: number;
  name: string;
  display_order?: number;
};

export type GroupUpdate = Partial<Pick<ExerciseGroup, (typeof UPDATABLE_GROUP_COLUMNS)[number]>>;

export function createGroup(db: Connection, input: CreateGroupInput): ExerciseGroup {
  return db
    .prepare(
      `INSERT INTO exercise_groups (user_id, name, display_order)
       VALUES (?, ?, ?)
       RETURNING ${GROUP_COLUMNS}`,
    )
    .get(input.user_id, input.name, input.display_order ?? 0) as ExerciseGroup;
}

export function findGroupById(db: Connection, userId: number, id: number): ExerciseGroup | null {
  const row = db
    .prepare(`SELECT ${GROUP_COLUMNS} FROM exercise_groups WHERE id = ? AND user_id = ?`)
    .get(id, userId) as ExerciseGroup | undefined;
  return row ?? null;
}

export function listGroups(db: Connection, userId: number): ExerciseGroup[] {
  return db
    .prepare(
      `SELECT ${GROUP_COLUMNS}
       FROM exercise_groups
       WHERE user_id = ?
       ORDER BY display_order, name`,
    )
    .all(userId) as ExerciseGroup[];
}

export function updateGroup(
  db: Connection,
  userId: number,
  id: number,
  patch: GroupUpdate,
): ExerciseGroup | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_GROUP_COLUMNS)[number] =>
    (UPDATABLE_GROUP_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findGroupById(db, userId, id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE exercise_groups SET ${set} WHERE id = ? AND user_id = ?`).run(
    ...values,
    id,
    userId,
  );
  return findGroupById(db, userId, id);
}

export function deleteGroup(db: Connection, userId: number, id: number): void {
  db.prepare("DELETE FROM exercise_groups WHERE id = ? AND user_id = ?").run(id, userId);
}
