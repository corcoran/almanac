-- Per-user hard daily token cap. NULL means the user is bound only by
-- ALMANAC_LLM_HARD_DAILY_TOKEN_CAP; the effective ceiling is the lower of
-- whichever of the two are set (see effectiveHardCap).
ALTER TABLE users ADD COLUMN llm_daily_hard_cap INTEGER;
