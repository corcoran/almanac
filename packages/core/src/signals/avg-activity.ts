/**
 * Workout duration → kcal fallback when `est_kcal` is null. Used by the per-day
 * activity totals (today.ts / macros.ts / signals.ts) so those composites use
 * consistent accounting. 6 kcal/min is a conservative resistance-training
 * estimate (~6 MET).
 */
export const WORKOUT_KCAL_PER_MIN = 6;
