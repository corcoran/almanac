-- Generic run-once registry: a keyed marker for one-time boot-time tasks
-- (e.g. recomputing a derived snapshot after a signal-calculation change).
-- runOnce(db, key, fn) inserts the key after fn succeeds; presence => skip.
CREATE TABLE IF NOT EXISTS one_shot_tasks (
  key          TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
