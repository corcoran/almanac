-- 012: widen accomplishments.code CHECK to include 'strength_pr'.
-- SQLite can't ALTER a CHECK constraint, so rebuild the table: create a new
-- table with the expanded CHECK, copy rows, drop the old, rename, recreate the
-- index. Column order, types, defaults, and the UNIQUE/CHECK constraints are
-- reproduced exactly from migration 011 (plus the new code).

CREATE TABLE accomplishments_new (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  code        TEXT    NOT NULL
              CHECK (code IN (
                'weigh_in_streak',
                'workout_consistency',
                'target_adherence_streak',
                'weight_milestone',
                'tdee_measured',
                'strength_pr'
              )),
  earned_on   TEXT    NOT NULL,
  value       REAL    NOT NULL DEFAULT 0,
  -- Generalizable dedup discriminator. `value` alone can't express per-phase
  -- semantics: weight_milestone keys on "<phase_id>:<kg>" so the same kg in a
  -- new phase is a distinct win, while streak/tdee wins key on their threshold
  -- magnitude (lifetime/threshold dedup, unchanged).
  dedup_key   TEXT    NOT NULL,
  details_json TEXT   NOT NULL DEFAULT '{}',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, code, dedup_key)
);

INSERT INTO accomplishments_new
  (id, user_id, code, earned_on, value, dedup_key, details_json, created_at)
  SELECT id, user_id, code, earned_on, value, dedup_key, details_json, created_at
  FROM accomplishments;

DROP TABLE accomplishments;
ALTER TABLE accomplishments_new RENAME TO accomplishments;

CREATE INDEX idx_accomplishments_user_code
  ON accomplishments(user_id, code, earned_on);
