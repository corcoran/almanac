CREATE TABLE step_logs (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  on_date     TEXT    NOT NULL,
  steps       INTEGER NOT NULL CHECK (steps >= 0),
  est_kcal    INTEGER,
  source      TEXT    NOT NULL DEFAULT 'manual'
              CHECK (source IN ('manual','import')),
  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, on_date)
);
CREATE INDEX idx_step_logs_user_date ON step_logs(user_id, on_date);
