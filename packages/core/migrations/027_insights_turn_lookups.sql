-- 027_insights_turn_lookups.sql
-- The lookups (tool calls) behind each coach reply, replayed to the model with
-- conversation history so it knows which of its earlier figures came from data.
ALTER TABLE insights_chat_turns ADD COLUMN lookups TEXT;
