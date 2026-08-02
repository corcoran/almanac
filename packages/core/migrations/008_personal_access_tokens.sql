-- packages/core/migrations/007_personal_access_tokens.sql

ALTER TABLE users ADD COLUMN email TEXT;

CREATE TABLE IF NOT EXISTS personal_access_tokens (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  prefix        TEXT NOT NULL,
  last_used_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_pat_user ON personal_access_tokens(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pat_hash ON personal_access_tokens(token_hash) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;
