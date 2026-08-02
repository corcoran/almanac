export type Set = {
  id: number;
  exercise_instance_id: number;
  set_number: number;
  reps: number;
  weight_kg: number | null;
  notes: string | null;
};

export type ExerciseInstance = {
  id: number;
  workout_id: number;
  exercise_id: number;
  display_order: number;
  planned_sets: number;
  notes: string | null;
  /**
   * ISO timestamp when set: the user explicitly skipped this exercise (came in
   * as a `skip` deviation against the template). `null` when the row was
   * logged normally — including the "bombed it" case where `sets: []` but
   * the user attempted it. See workouts.repo `applyTemplateWithDeviations`.
   */
  skipped_at: string | null;
  sets?: Set[];
};

export type Workout = {
  id: number;
  user_id: number;
  template_id: number | null;
  started_at: string;
  duration_min: number | null;
  rpe: number;
  est_kcal: number | null;
  notes: string | null;
  created_at: string;
  exercises?: ExerciseInstance[];
};
