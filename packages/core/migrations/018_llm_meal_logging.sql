-- 018_llm_meal_logging.sql
-- Schema for the LLM meal-logging feature (Spec 1) plus columns used by the
-- admin-management (Spec 1.5) and limit-enforcement (Spec 3) specs.
--
-- User columns:
--   llm_logging_enabled   per-user gate flag (default off — new deployments dark)
--   is_admin              authorizes admin-only management actions (read in 1.5)
--   llm_daily_token_limit nullable per-user daily cap; NULL → env default (read in 3)
ALTER TABLE users ADD COLUMN llm_logging_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN llm_daily_token_limit INTEGER;

-- One row per LLM call. Token buckets are kept separate because each prices
-- differently (cache reads ~0.1x, writes ~1.25x). cost_usd is frozen at write
-- time from the in-code price table so historical totals stay accurate when
-- prices change. provider is recorded per-row to keep cost semantics correct
-- if a second provider is ever added.
CREATE TABLE llm_usage (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  created_at            TEXT    NOT NULL,
  provider              TEXT    NOT NULL,
  model                 TEXT    NOT NULL,
  feature               TEXT    NOT NULL,
  input_tokens          INTEGER NOT NULL,
  output_tokens         INTEGER NOT NULL,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd              REAL    NOT NULL
);

CREATE INDEX idx_llm_usage_user_created ON llm_usage (user_id, created_at);
