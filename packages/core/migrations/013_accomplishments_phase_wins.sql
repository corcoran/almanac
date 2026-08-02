-- Widen the accomplishments.code CHECK to admit the phase-result wins
-- ('phase_complete', 'phase_halfway'). Builds on migration 012, which added
-- 'strength_pr' — that code is preserved here so existing strength_pr rows
-- survive the rebuild's INSERT...SELECT.
-- SQLite can't ALTER a CHECK constraint, so rebuild the table (preserving the
-- UNIQUE (user_id, code, dedup_key) constraint and the user/code/earned_on index).
PRAGMA foreign_keys=OFF;

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
                'strength_pr',
                'phase_complete',
                'phase_halfway'
              )),
  earned_on   TEXT    NOT NULL,
  value       REAL    NOT NULL DEFAULT 0,
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

PRAGMA foreign_keys=ON;
