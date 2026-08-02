-- Stored meals: a user-scoped library of reusable meal definitions.
-- Timeless (no eaten_at) — logging from one creates a normal `meals` row.
-- `name` is unique per user; the define path upserts on (user_id, name).
CREATE TABLE stored_meals (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  name        TEXT    NOT NULL,
  kcal        INTEGER NOT NULL,
  protein_g   REAL    NOT NULL,
  carb_g      REAL    NOT NULL,
  fat_g       REAL    NOT NULL,
  description TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, name)
);
CREATE INDEX idx_stored_meals_user ON stored_meals(user_id);
