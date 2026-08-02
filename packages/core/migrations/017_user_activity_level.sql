-- 017_user_activity_level.sql
-- Adds a nullable activity_level to users. Drives the cold-start TDEE
-- multiplier (profileBaselineTDEE). Nullable, no default, no backfill:
-- every existing user stays NULL and the signal falls back to the prior
-- hardcoded 1.4 multiplier, so behavior is unchanged for them.
ALTER TABLE users ADD COLUMN activity_level TEXT
  CHECK (activity_level IN ('sedentary','light','moderate','active','very_active'));
