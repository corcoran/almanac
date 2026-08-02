import type { Connection } from "../db/connection.js";

/**
 * Run `fn` exactly once, ever, for the given `key`. The key is recorded in the
 * `one_shot_tasks` table only AFTER `fn` succeeds (inside the same transaction),
 * so a crash mid-run leaves the key absent and the task retries on the next
 * boot. Idempotent across process restarts. Use for one-time boot-time data
 * migrations that can't live in a pure-SQL migration — e.g. recomputing a
 * derived snapshot after a signal-calculation change.
 *
 * Requires migration 023 (the `one_shot_tasks` table) to have run.
 */
export function runOnce(db: Connection, key: string, fn: (db: Connection) => void): void {
  const already = db.prepare("SELECT 1 FROM one_shot_tasks WHERE key = ?").get(key);
  if (already !== undefined) return;

  const tx = db.transaction(() => {
    fn(db);
    db.prepare("INSERT INTO one_shot_tasks (key) VALUES (?)").run(key);
  });
  tx();
}
