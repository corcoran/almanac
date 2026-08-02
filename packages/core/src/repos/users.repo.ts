import type { Connection } from "../db/connection.js";
import type { User } from "../domain/users.js";

// Columns updateUser is allowed to mutate. Keys outside this allowlist are
// rejected, even if a non-strict Zod schema upstream let them through.
const UPDATABLE_COLUMNS = [
  "name",
  "dob",
  "height_cm",
  "sex",
  "preferred_unit_system",
  "timezone",
  "activity_level",
  "llm_logging_enabled",
  "is_admin",
  "llm_daily_token_limit",
  "about_me",
] as const satisfies readonly (keyof User)[];

export type UserUpdate = Partial<Pick<User, (typeof UPDATABLE_COLUMNS)[number]>>;

export function findUserById(db: Connection, id: number): User | null {
  const row = db
    .prepare(
      `SELECT id, name, dob, height_cm, sex, email, preferred_unit_system, timezone, activity_level, llm_logging_enabled, is_admin, llm_daily_token_limit, about_me, created_at
       FROM users WHERE id = ?`,
    )
    .get(id) as User | undefined;
  return row ?? null;
}

export function listUsers(db: Connection): User[] {
  return db
    .prepare(
      `SELECT id, name, dob, height_cm, sex, email, preferred_unit_system, timezone, activity_level, llm_logging_enabled, is_admin, llm_daily_token_limit, about_me, created_at
       FROM users ORDER BY id`,
    )
    .all() as User[];
}

export function updateUser(db: Connection, id: number, patch: UserUpdate): User | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_COLUMNS)[number] =>
    (UPDATABLE_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findUserById(db, id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE users SET ${set} WHERE id = ?`).run(...values, id);
  return findUserById(db, id);
}
