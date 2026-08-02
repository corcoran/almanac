CREATE TABLE daily_net (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  on_date     TEXT    NOT NULL,         -- user-local YYYY-MM-DD (day D)
  net_kcal    INTEGER NOT NULL,         -- intake_kcal - tdee_used (deficit<0, surplus>0)
  intake_kcal INTEGER NOT NULL,         -- meals+alcohol for D (always > 0)
  tdee_used   INTEGER NOT NULL,         -- computed TDEE asOf (D-1)
  tdee_basis  TEXT    NOT NULL          -- 'profile_baseline' | 'measured_intake'
              CHECK (tdee_basis IN ('profile_baseline','measured_intake')),
  computed_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, on_date)
);
