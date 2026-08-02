-- 006: TDEE refactor — static target with observed telemetry
-- Renames base_kcal → daily_kcal_target, adds tdee_at_phase_start,
-- tdee_source, deficit_kcal, phase_type. Backfills current active phase
-- with user-asserted values per spec
-- (docs/superpowers/specs/2026-05-23-tdee-refactor-design.md).

-- 1. Add new columns. phase_type is CHECK-constrained to the v1 enum.
--    All four are nullable: historical phases will keep NULL on the new
--    fields; only the current active phase gets backfilled in step 3.
ALTER TABLE nutrition_phases ADD COLUMN phase_type TEXT
  CHECK (phase_type IS NULL OR phase_type IN ('cut','bulk','maintenance'));
ALTER TABLE nutrition_phases ADD COLUMN tdee_at_phase_start INTEGER;
ALTER TABLE nutrition_phases ADD COLUMN tdee_source TEXT
  CHECK (tdee_source IS NULL OR tdee_source IN ('formula','measured','user_asserted'));
ALTER TABLE nutrition_phases ADD COLUMN deficit_kcal INTEGER;

-- 2. Rename base_kcal → daily_kcal_target.
--    SQLite supports ALTER TABLE ... RENAME COLUMN since 3.25.0.
ALTER TABLE nutrition_phases RENAME COLUMN base_kcal TO daily_kcal_target;

-- 3. Safety assertion BEFORE backfill: verify AT MOST one active phase exists.
--    Multiple active phases would mean a data-integrity violation (the schema's
--    idx_nutrition_phases_user_active doesn't enforce uniqueness). Zero active
--    phases is acceptable — happens on fresh installations and test DBs, and
--    just means the backfill is a no-op.
--    Implementation: a temp table with a CHECK constraint that fails the
--    INSERT if the assertion is violated.
CREATE TEMP TABLE _active_phase_count_check (n INTEGER CHECK (n <= 1));
INSERT INTO _active_phase_count_check
  SELECT COUNT(*) FROM nutrition_phases WHERE ended_on IS NULL;
DROP TABLE _active_phase_count_check;

-- 4. Backfill the current active phase. Per spec:
--    tdee_at_phase_start = 2370 (user's asserted TDEE at phase start)
--    deficit_kcal        = -470  (gives daily_kcal_target 1900 = 2370 + (-470))
--    phase_type          = 'cut'
--    tdee_source         = 'user_asserted'
UPDATE nutrition_phases
SET
  phase_type = 'cut',
  tdee_at_phase_start = 2370,
  tdee_source = 'user_asserted',
  deficit_kcal = -470
WHERE ended_on IS NULL;
