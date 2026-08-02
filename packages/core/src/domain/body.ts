export type BodyWeight = {
  id: number;
  user_id: number;
  measured_on: string;
  weight_kg: number;
  notes: string | null;
  created_at: string;
};

export type CardioSession = {
  id: number;
  user_id: number;
  started_at: string;
  duration_min: number | null;
  modality: string | null;
  avg_hr: number | null;
  distance_km: number | null;
  /**
   * Per-session step count from a watch/phone pedometer, when the cardio app
   * exposes one. Distinct from `step_logs` (which stores device-aggregated
   * DAILY totals as a first-class NEAT source). Currently unused by signals —
   * kept here only because the column exists in `cardio_sessions` and may
   * be useful for future per-session analytics.
   */
  steps: number | null;
  est_kcal: number;
  notes: string | null;
  created_at: string;
};

export type SleepLog = {
  id: number;
  user_id: number;
  slept_on: string;
  hours: number;
  quality: number | null;
  notes: string | null;
  created_at: string;
};

export type AlcoholSession = {
  id: number;
  user_id: number;
  started_at: string;
  ended_at: string | null;
  drinks_count: number;
  est_kcal: number;
  notes: string | null;
  created_at: string;
};

export type StepLog = {
  id: number;
  user_id: number;
  on_date: string;
  steps: number;
  est_kcal: number | null;
  source: "manual" | "import";
  notes: string | null;
  created_at: string;
};
