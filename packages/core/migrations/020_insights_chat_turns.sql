-- 020_insights_chat_turns.sql
-- Server-side transcript of the Insights chat, one conversation per user-local
-- day (4am rollover). `on_date` is the user-local YYYY-MM-DD (NOT a UTC truncation).
-- `seq` orders turns within a day's conversation and makes append idempotent via
-- the unique constraint. Usage stays in llm_usage; this table is the transcript only.
CREATE TABLE insights_chat_turns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  on_date     TEXT    NOT NULL,
  seq         INTEGER NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  UNIQUE (user_id, on_date, seq)
);
CREATE INDEX idx_insights_turns_user_day ON insights_chat_turns (user_id, on_date);
