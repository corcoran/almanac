import type { Connection } from "../db/connection.js";
import { addDaysIso } from "../domain/user-day.js";
import { listGroups } from "../repos/exercise-groups.repo.js";
import { listExercises } from "../repos/exercises.repo.js";
import { listTemplates } from "../repos/workout-templates.repo.js";
import { listWorkoutsWithDetail } from "../repos/workouts.repo.js";
import { recommendTemplate, type TemplateRecommendation } from "./recommend-template.js";
import { computeStimStates } from "./stim.js";

/**
 * Assemble the recommend-template inputs for one user from their stored data and
 * run the signal. Extracted from the /v1/signals/recommend-template route (whose
 * TODO anticipated a third caller — the insights read-tool). Behaviour-identical
 * to the route's former inline block.
 */
export function recommendTemplateForUser(
  db: Connection,
  userId: number,
  now: Date,
  opts: { topN: number },
): { recommendations: TemplateRecommendation[] } {
  const today = now.toISOString().slice(0, 10);
  const thirtyFiveDaysAgo = addDaysIso(today, -34);

  const groups = listGroups(db, userId);
  const exercises = listExercises(db, userId, { includeArchived: true });
  const exerciseToGroup = new Map(exercises.map((e) => [e.id, e.group_id]));
  const workouts35 = listWorkoutsWithDetail(db, userId, {
    from: `${thirtyFiveDaysAgo}T00:00:00Z`,
    to: `${addDaysIso(today, 1)}T00:00:00Z`,
    limit: 200,
  });
  const latestBwRow = db
    .prepare(
      `SELECT weight_kg FROM body_weights
       WHERE user_id = ?
       ORDER BY measured_on DESC LIMIT 1`,
    )
    .get(userId) as { weight_kg: number } | undefined;

  const stimStates = computeStimStates({
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    workouts: workouts35.map((w) => ({
      id: w.id,
      started_at: w.started_at,
      rpe: w.rpe,
      // Skipped rows must not count (matches the today.ts policy).
      exercises: (w.exercises ?? [])
        .filter((ei) => ei.skipped_at == null)
        .map((ei) => ({
          exercise_id: ei.exercise_id,
          sets: (ei.sets ?? []).map((s) => ({ reps: s.reps, weight_kg: s.weight_kg })),
        })),
    })),
    exerciseToGroup,
    latestBodyWeightKg: latestBwRow?.weight_kg ?? null,
    now,
  });

  const templates = listTemplates(db, userId, { includeArchived: false });
  const all = recommendTemplate({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      items: (t.items ?? []).map((i) => ({ exercise_id: i.exercise_id })),
    })),
    stimStates,
    exerciseToGroup,
  });
  return { recommendations: all.slice(0, opts.topN) };
}
