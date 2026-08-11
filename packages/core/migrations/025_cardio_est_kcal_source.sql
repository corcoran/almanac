-- Records who produced est_kcal, and with which formula when it was us.
-- NULL means the row predates this column: treat it as user-supplied, since
-- every write before now required the caller to pass a number.
ALTER TABLE cardio_sessions ADD COLUMN est_kcal_source TEXT;
