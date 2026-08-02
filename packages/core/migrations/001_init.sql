-- Almanac initial schema. Forward-only; never edit after release.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT    NOT NULL,
  dob                   TEXT,
  height_cm             REAL,
  sex                   TEXT CHECK (sex IN ('male','female')),
  preferred_unit_system TEXT    NOT NULL DEFAULT 'metric'
                        CHECK (preferred_unit_system IN ('metric','imperial')),
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE exercise_groups (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  name          TEXT    NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, name)
);

CREATE TABLE exercises (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  group_id      INTEGER NOT NULL REFERENCES exercise_groups(id),
  name          TEXT    NOT NULL,
  notes         TEXT,
  archived_at   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_exercises_user_name_active
  ON exercises (user_id, name)
  WHERE archived_at IS NULL;

CREATE TABLE workout_templates (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  name          TEXT    NOT NULL,
  notes         TEXT,
  archived_at   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_workout_templates_user_name_active
  ON workout_templates (user_id, name)
  WHERE archived_at IS NULL;

CREATE TABLE workout_template_items (
  id                INTEGER PRIMARY KEY,
  template_id       INTEGER NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
  exercise_id       INTEGER NOT NULL REFERENCES exercises(id),
  display_order     INTEGER NOT NULL,
  default_sets      INTEGER NOT NULL,
  default_reps      INTEGER,
  default_weight_kg REAL,
  notes             TEXT,
  UNIQUE (template_id, display_order)
);

CREATE TABLE workouts (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  template_id   INTEGER REFERENCES workout_templates(id),
  started_at    TEXT    NOT NULL,
  duration_min  INTEGER,
  rpe           REAL    NOT NULL CHECK (rpe BETWEEN 1 AND 10),
  est_kcal      INTEGER,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_workouts_user_started ON workouts(user_id, started_at);

CREATE TABLE exercise_instances (
  id            INTEGER PRIMARY KEY,
  workout_id    INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id   INTEGER NOT NULL REFERENCES exercises(id),
  display_order INTEGER NOT NULL,
  planned_sets  INTEGER NOT NULL,
  notes         TEXT,
  UNIQUE (workout_id, display_order)
);
CREATE INDEX idx_exercise_instances_workout ON exercise_instances(workout_id);
CREATE INDEX idx_exercise_instances_exercise ON exercise_instances(exercise_id);

CREATE TABLE sets (
  id                    INTEGER PRIMARY KEY,
  exercise_instance_id  INTEGER NOT NULL REFERENCES exercise_instances(id) ON DELETE CASCADE,
  set_number            INTEGER NOT NULL,
  reps                  INTEGER NOT NULL,
  weight_kg             REAL,
  notes                 TEXT,
  UNIQUE (exercise_instance_id, set_number)
);
CREATE INDEX idx_sets_instance ON sets(exercise_instance_id);

CREATE TABLE body_weights (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  measured_on   TEXT    NOT NULL,
  weight_kg     REAL    NOT NULL,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, measured_on)
);

CREATE TABLE nutrition_phases (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  name            TEXT    NOT NULL,
  intent          TEXT    NOT NULL CHECK (intent IN ('cut','bulk','recomp','maintenance')),
  base_kcal       INTEGER NOT NULL,
  base_protein_g  INTEGER NOT NULL,
  base_carb_g     INTEGER NOT NULL,
  base_fat_g      INTEGER NOT NULL,
  started_on      TEXT    NOT NULL,
  ended_on        TEXT,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_nutrition_phases_user_active ON nutrition_phases(user_id, ended_on);

CREATE TABLE meals (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  eaten_at      TEXT    NOT NULL,
  name          TEXT,
  kcal          INTEGER NOT NULL,
  protein_g     REAL    NOT NULL,
  carb_g        REAL    NOT NULL,
  fat_g         REAL    NOT NULL,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_meals_user_eaten ON meals(user_id, eaten_at);

CREATE TABLE cardio_sessions (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  started_at    TEXT    NOT NULL,
  duration_min  INTEGER,
  modality      TEXT,
  avg_hr        INTEGER,
  distance_km   REAL,
  est_kcal      INTEGER NOT NULL,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_cardio_user_started ON cardio_sessions(user_id, started_at);

CREATE TABLE sleep_logs (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  slept_on      TEXT    NOT NULL,
  hours         REAL    NOT NULL,
  quality       INTEGER CHECK (quality BETWEEN 1 AND 5),
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, slept_on)
);

CREATE TABLE alcohol_sessions (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  started_at    TEXT    NOT NULL,
  ended_at      TEXT,
  drinks_count  REAL    NOT NULL,
  est_kcal      INTEGER NOT NULL,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_alcohol_user_started ON alcohol_sessions(user_id, started_at);

CREATE TABLE idempotency_keys (
  key         TEXT    PRIMARY KEY,
  response    TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);
