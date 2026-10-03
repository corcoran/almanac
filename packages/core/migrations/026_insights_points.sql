-- 026_insights_points.sql
-- Points the insights coach has already explained, so it doesn't repeat them.
-- A point outlives its conversation: resetting a day deletes the turns, and
-- turn_id goes NULL, but the point and its helpful flag stay.
CREATE TABLE insights_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  turn_id     INTEGER REFERENCES insights_chat_turns(id) ON DELETE SET NULL,
  on_date     TEXT    NOT NULL,
  topic       TEXT    NOT NULL,
  gist        TEXT    NOT NULL,
  helpful     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL
);
CREATE INDEX idx_insights_points_user_created ON insights_points (user_id, created_at);

ALTER TABLE insights_chat_turns ADD COLUMN helpful INTEGER NOT NULL DEFAULT 0;
