import type { Connection } from "../db/connection.js";

export type SeedInput = {
  name: string;
  dob: string | null; // YYYY-MM-DD
  height_cm: number | null;
  sex: "male" | "female" | null;
};

/**
 * Seeds the first user row into an empty database. Throws if any user already
 * exists — callers handle that as a conflict.
 *
 * DEV/TEST ONLY. This is reachable from the CLI seed scripts (seed-demo,
 * seed-user, seed-accomplishments) and tests; it is deliberately NOT exposed
 * over the API or MCP. The row it writes has NO email, and production account
 * lookup is by email (`resolveEmailToUserId` in the API's auth layer), so an
 * email-less row would be invisible at sign-in — the signer-in would get a
 * SECOND account and this row's data would be stranded. Real accounts are
 * provisioned by the auth layer, which always sets the verified email.
 *
 * The seeded user is the FIRST user (this throws otherwise), so it is
 * bootstrapped as admin (`is_admin = 1`), matching what the auth layer does
 * for the first real sign-in.
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
