export type PhaseIntent = "cut" | "bulk" | "recomp" | "maintenance";

/**
 * Narrow enum for the v1 TDEE refactor. Distinct from {@link PhaseIntent}
 * (which retains the legacy 'recomp' value for backward compatibility with
 * pre-refactor phases). `phase_type` is nullable: historical phases created
 * before migration 006 keep NULL.
 */
export type PhaseType = "cut" | "bulk" | "maintenance";

/**
 * How `tdee_at_phase_start` was derived. Nullable for the same reason as
 * `phase_type` — pre-refactor phases have no TDEE captured.
 */
export type TdeeSource = "formula" | "measured" | "user_asserted";

export type NutritionPhase = {
  id: number;
  user_id: number;
  name: string;
  intent: PhaseIntent;
  /** Null on historical (pre-refactor) phases; required on new phases. */
  phase_type: PhaseType | null;
  /** TDEE snapshot at phase start (kcal/day). Null on historical phases. */
  tdee_at_phase_start: number | null;
  /** Provenance for `tdee_at_phase_start`. Null on historical phases. */
  tdee_source: TdeeSource | null;
  /**
   * Signed daily kcal deficit/surplus relative to `tdee_at_phase_start`.
   * Negative for cuts, positive for bulks, 0 (or null) for maintenance.
   * Null on historical phases.
   */
  deficit_kcal: number | null;
  /** Renamed from `base_kcal` in migration 006. */
  daily_kcal_target: number;
  base_protein_g: number;
  base_carb_g: number;
  base_fat_g: number;
  started_on: string;
  /**
   * Planned end date for this phase (YYYY-MM-DD). Distinct from `ended_on`
   * (the actual close timestamp set when a successor phase begins). The
   * planned date lets get_today_context surface days_remaining for cut/bulk
   * progress reasoning (Gap 25).
   */
  planned_end_on: string | null;
  ended_on: string | null;
  notes: string | null;
  created_at: string;
};

export type Meal = {
  id: number;
  user_id: number;
  eaten_at: string;
  name: string | null;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  notes: string | null;
  created_at: string;
};

export type StoredMeal = {
  id: number;
  user_id: number;
  name: string;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  description: string | null;
  created_at: string;
};
