-- 019_llm_web_search.sql
-- Web search (Spec 4): record real search count + the synthetic "billed" token
-- amount per call. input/output_tokens stay the TRUE API numbers; billed_tokens
-- is what the daily budget is charged (flat per-search price for search calls,
-- real input+output otherwise). Existing rows predate web search, so billed ==
-- input+output for all of them.
ALTER TABLE llm_usage ADD COLUMN web_search_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE llm_usage ADD COLUMN billed_tokens INTEGER NOT NULL DEFAULT 0;
UPDATE llm_usage SET billed_tokens = input_tokens + output_tokens;
