CREATE TABLE untracked_periods (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  started_on  TEXT    NOT NULL,
  ended_on    TEXT    NOT NULL,
  reason      TEXT    NOT NULL
              CHECK (reason IN ('vacation','sick','deload')),
  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (ended_on >= started_on)
);
CREATE INDEX idx_untracked_periods_user_range
  ON untracked_periods(user_id, started_on, ended_on);
