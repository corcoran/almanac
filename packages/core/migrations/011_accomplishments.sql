CREATE TABLE accomplishments (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  code        TEXT    NOT NULL
              CHECK (code IN (
                'weigh_in_streak',
                'workout_consistency',
                'target_adherence_streak',
                'weight_milestone',
                'tdee_measured'
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
CREATE INDEX idx_accomplishments_user_code
  ON accomplishments(user_id, code, earned_on);
