-- 021_insights_turn_sources.sql
-- Per-turn web-search sources for the Insights chat, stored as a JSON array
-- string (e.g. [{"url":"…","title":"…","domain":"…"}]) or NULL for turns that
-- ran no search. Nullable + additive so existing rows read as "no sources".
-- Dormant until the Insights coach has web search enabled; meal-chat sources are
-- not persisted (its history is client-side only).
ALTER TABLE insights_chat_turns ADD COLUMN sources TEXT;
