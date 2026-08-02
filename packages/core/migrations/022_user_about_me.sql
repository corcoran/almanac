-- 022_user_about_me.sql
-- Adds a nullable free-text "About Me" field to users. Holds durable, user-
-- described context (body type, goals, tone preferences) injected as ADVISORY
-- background into the LLM chat prompts and MCP. Nullable, no default, no
-- backfill: existing users stay NULL and the field is omitted from every prompt,
-- so behavior is unchanged for them.
ALTER TABLE users ADD COLUMN about_me TEXT;
