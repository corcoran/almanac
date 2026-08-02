import type { ActiveExercise, TemplateBaseline } from "./active-workout-types.js";

/**
 * Pure function: given the in-progress session exercises and the template
 * baseline they started from, compute the user-visible divergences per
 * spec §7.2. Asymmetric set-count rule: only *upward* set count changes
 * propagate to the template. Missed sets and skipped exercises and reorders
 * are session noise.
 */
export type Divergence =
  | {
      kind: "set_changes";
      exercise_id: number;
      exercise_name: string;
      /** Mode-of-completed reps across the session. Null if none completed. */
      new_default_reps: number | null;
      /** Mode-of-completed weight across the session. Null if none completed. */
      new_default_weight_kg: number | null;
    }
  | {
      kind: "added_sets";
      exercise_id: number;
      exercise_name: string;
      old_planned_sets: number;
      new_planned_sets: number;
    }
  | {
      kind: "added_exercise";
      exercise_id: number;
      name: string;
      group_id: number;
      /** Final session display_order. */
      display_order: number;
      planned_sets: number;
      default_reps: number | null;
      default_weight_kg: number | null;
    };

export function computeDivergences(
  exercises: ActiveExercise[],
  baseline: TemplateBaseline,
): Divergence[] {
  const baselineById = new Map(baseline.exercises.map((e) => [e.exercise_id, e]));
  const out: Divergence[] = [];

  for (const ex of exercises) {
    // Skipped exercises: never propagate (§7.2).
    if (ex.skipped) continue;

    // Ad-hoc added: flag as added_exercise.
    if (ex.added_mid_session) {
      const completed = ex.sets.filter((s) => s.done);
      if (completed.length === 0) continue; // user added but never completed a set — drop it
      out.push({
        kind: "added_exercise",
        exercise_id: ex.exercise_id,
        name: ex.name,
        group_id: ex.group_id,
        display_order: ex.display_order,
        planned_sets: completed.length,
        default_reps: mode(completed.map((s) => s.reps)) ?? null,
        default_weight_kg: mode(completed.map((s) => s.weight_kg)),
      });
      continue;
    }

    const tplItem = baselineById.get(ex.exercise_id);
    if (!tplItem) continue; // shouldn't happen for non-added exercises, but defensive

    const completedSets = ex.sets.filter((s) => s.done);

    // Added sets (upward only). Asymmetric per spec §7.2.
    if (completedSets.length > tplItem.planned_sets) {
      out.push({
        kind: "added_sets",
        exercise_id: ex.exercise_id,
        exercise_name: ex.name,
        old_planned_sets: tplItem.planned_sets,
        new_planned_sets: completedSets.length,
      });
    }

    // Reps/load change. Only flag if at least one set was completed and the
    // mode of completed reps OR weight differs from baseline.
    if (completedSets.length > 0) {
      const repsMode = mode(completedSets.map((s) => s.reps));
      const weightMode = mode(completedSets.map((s) => s.weight_kg));
      const repsChanged = repsMode !== null && repsMode !== tplItem.default_reps;
      const weightChanged = weightMode !== null && weightMode !== tplItem.default_weight_kg;
      if (repsChanged || weightChanged) {
        out.push({
          kind: "set_changes",
          exercise_id: ex.exercise_id,
          exercise_name: ex.name,
          new_default_reps: repsChanged ? (repsMode ?? null) : tplItem.default_reps,
          new_default_weight_kg: weightChanged ? (weightMode ?? null) : tplItem.default_weight_kg,
        });
      }
    }
  }

  return out;
}

/** Mode of an array (most common value). Null for empty / all-null arrays.
 *  Ties resolve to the first value encountered. */
function mode<T extends number | null>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: T | null = null;
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}
