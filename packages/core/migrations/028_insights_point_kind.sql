-- 028_insights_point_kind.sql
-- "told": something the coach explained. "learned": something the user told or
-- corrected the coach on.
ALTER TABLE insights_points ADD COLUMN kind TEXT NOT NULL DEFAULT 'told'
  CHECK (kind IN ('told', 'learned'));
