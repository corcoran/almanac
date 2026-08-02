/**
 * Shapes used by the in-progress workout (Stage 2). Lives in localStorage
 * until session end. Spec §4.4, §4.6.
 *
 * Important — the version constant gates schema compatibility.
 * Bump it whenever any field below changes shape. On load, an entry with
 * a mismatched schema_version is discarded with a notice (§4.5).
 */
export const ACTIVE_WORKOUT_SCHEMA_VERSION = 1 as const;

export type ActiveSet = {
  /** 1-based, per packages/core/src/schemas/workouts.ts SetResponseSchema. */
  set_number: number;
  /** What the user is logging. Filled in from the prior set's actuals on next-set inheritance. */
  reps: number;
  /** Optional — bodyweight exercises may omit. */
  weight_kg: number | null;
  /** True once the user clicks ✓. The set is considered "completed". */
  done: boolean;
};

export type ActiveExercise = {
  /** Stable client-side id for v-for keys (UUID or counter). NOT the future server id. */
  client_id: string;
  /** Exercise from the user's library. */
  exercise_id: number;
  /** Cached display fields so the UI doesn't have to re-join on every render. */
  name: string;
  group_id: number;
  /** True if this exercise wasn't on the template at session-start. Used by divergence diff. */
  added_mid_session: boolean;
  /** Current display order in the session (1-based for UI). Reorders are NOT propagated to template. */
  display_order: number;
  /** Sets the user has worked. Includes both completed (done: true) and not-yet-completed. */
  sets: ActiveSet[];
  /**
   * Set-number-or-position the template originally specified. Used to compute
   * "set count increased" divergence. For added-mid-session exercises this is 0.
   */
  baseline_planned_sets: number;
  /**
   * True if the user explicitly chose to skip this exercise mid-session.
   * Skipped exercises never propagate to the template (§7.2).
   */
  skipped: boolean;
};

/**
 * Frozen snapshot of the template at session-start. Read-only for the duration
 * of the session. Spec §4.6. This is the baseline for the end-session diff.
 */
export type TemplateBaseline = {
  template_id: number;
  template_name: string;
  /** Same shape as ActiveExercise.baseline_planned_sets keyed by exercise_id. */
  exercises: Array<{
    exercise_id: number;
    name: string;
    group_id: number;
    display_order: number;
    planned_sets: number;
    default_reps: number | null;
    default_weight_kg: number | null;
  }>;
};

export type ActiveWorkout = {
  schema_version: typeof ACTIVE_WORKOUT_SCHEMA_VERSION;
  /** ISO timestamp captured when the user clicked a template in IdleView. */
  started_at: string;
  template_id: number;
  template_baseline: TemplateBaseline;
  exercises: ActiveExercise[];
  /** Required per spec §7.2 before End Session can fire. */
  rpe: number | null;
  /** Set on submit-failure; retry tracker. */
  pending_submit?: true;
  /** Set on workout-POST-success + template-PUT-failure; partial retry tracker. */
  pending_template_patch?: { workout_id: number };
};
