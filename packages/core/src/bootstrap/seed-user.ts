import type { Connection } from "../db/connection.js";

export type SeedInput = {
  name: string;
  dob: string | null; // YYYY-MM-DD
  height_cm: number | null;
  sex: "male" | "female" | null;
};

/**
 * Inserts the single user row for this single-user app. Throws if a user
 * already exists — callers handle this as a "409 Conflict" or equivalent.
 *
 * The seeded user is the FIRST user (this throws otherwise), so it owns the
 * instance and is bootstrapped as admin (`is_admin = 1`). This self-bootstraps
 * a fresh deployment so the admin tooling isn't locked out without a manual DB
 * edit. It only ever fires on an empty users table, so it cannot grant admin on
 * an existing deployment.
 *
 * Does NOT create a nutrition phase. The first `start_nutrition_phase`
 * call is responsible for that; phase IDs start at 1 instead of 2.
 */
export function seedUser(db: Connection, input: SeedInput): { user_id: number } {
  const existing = db.prepare("SELECT id FROM users LIMIT 1").get() as { id: number } | undefined;
  if (existing) {
    throw new Error(`User already exists (id=${existing.id}); refusing to seed`);
  }
  const r = db
    .prepare(
      `INSERT INTO users (name, dob, height_cm, sex, is_admin)
       VALUES (?, ?, ?, ?, 1)`,
    )
    .run(input.name, input.dob, input.height_cm, input.sex);
  return { user_id: Number(r.lastInsertRowid) };
}
