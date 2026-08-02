import type { Connection } from "@almanac/core/db";

/**
 * One-shot hook: if `email` is provided, bind it to `users.id = 1` IFF that
 * row exists and currently has no email. Returns true when a row was bound
 * (caller may log), false otherwise (no-op).
 *
 * Idempotent — running it again after the column is set is a silent no-op
 * (the WHERE clause filters out already-bound rows).
 *
 * Lifecycle: called at server startup right after migrations apply. The
 * operator sets ALMANAC_FIRST_LOGIN_EMAIL in the .env for their first deploy,
 * confirms the binding stuck via `SELECT email FROM users WHERE id = 1`, then
 * removes the env var. On subsequent boots the env var is absent and this
 * function is a no-op.
 *
 * This is NOT a migration — migrations are schema; this is data. Keeping it
 * out of the migrations directory means re-running migrations on a fresh DB
 * doesn't auto-bind a stale email.
 */
export function bindFirstLoginEmail(db: Connection, email: string | undefined): boolean {
  if (!email || email.trim() === "") return false;
  // Idempotent: WHERE clause filters out already-bound or missing rows.
  const result = db.prepare(`UPDATE users SET email = ? WHERE id = 1 AND email IS NULL`).run(email);
  return result.changes > 0;
}
