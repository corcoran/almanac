import { WorkoutResponseSchema, WorkoutTemplateResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";
import {
  ACTIVE_WORKOUT_SCHEMA_VERSION,
  type ActiveExercise,
  type ActiveSet,
  type ActiveWorkout,
  type TemplateBaseline,
} from "../lib/active-workout-types.js";
import { computeDivergences, type Divergence } from "../lib/divergence-diff.js";
import {
  clearActiveWorkout,
  loadActiveWorkout,
  saveActiveWorkout,
} from "../lib/localStorageAdapter.js";

// Note: the POST /v1/workouts request body (CreateWorkoutBodySchema in
// @almanac/core/schemas) is validated server-side. We don't re-validate
// client-side — the body shape is built by buildWorkoutBody() below and
// the server returns 400 if it's wrong (surfaced as ApiError "http").

export type EndSessionResult =
  | { status: "submitted"; workout_id: number }
  | { status: "workout_failed"; error: ApiError }
  | { status: "template_failed"; workout_id: number; error: ApiError }
  | { status: "no_active_session" };

let clientIdCounter = 0;
function nextClientId(): string {
  clientIdCounter += 1;
  return `c-${clientIdCounter}-${Date.now()}`;
}

export const useWorkoutStore = defineStore("workout", {
  state: () => ({
    active: null as ActiveWorkout | null,
  }),
  getters: {
    hasActiveSession(state): boolean {
      return state.active !== null;
    },
  },
  actions: {
    /** Restore from localStorage on app boot (App.vue calls this synchronously). */
    hydrate(): void {
      const loaded = loadActiveWorkout();
      if (loaded !== null) this.active = loaded;
    },

    /**
     * Begin a session. `startedAt` is a naive-local wall-clock string
     * (`YYYY-MM-DDTHH:MM:SS`, no `Z`) composed by the caller from the user's
     * timezone via `nowNaiveLocal` — NOT `new Date().toISOString()`. The naive
     * form lets the API bucket the workout onto the user's actual day; a UTC-`Z`
     * string makes an evening workout for a west-of-UTC user land on tomorrow.
     */
    startSession(baseline: TemplateBaseline, startedAt: string): void {
      const exercises: ActiveExercise[] = baseline.exercises.map((tpl) => ({
        client_id: nextClientId(),
        exercise_id: tpl.exercise_id,
        name: tpl.name,
        group_id: tpl.group_id,
        added_mid_session: false,
        display_order: tpl.display_order,
        baseline_planned_sets: tpl.planned_sets,
        skipped: false,
        sets: makeInitialSets(tpl.planned_sets, tpl.default_reps, tpl.default_weight_kg),
      }));
      this.active = {
        schema_version: ACTIVE_WORKOUT_SCHEMA_VERSION,
        started_at: startedAt,
        template_id: baseline.template_id,
        template_baseline: baseline,
        exercises,
        rpe: null,
      };
      this.persist();
    },

    tickSet(client_id: string, set_number: number): void {
      const set = this.findSet(client_id, set_number);
      if (!set) return;
      set.done = true;
      // Set inheritance: next not-yet-completed set on the same exercise
      // inherits this set's actuals (§7.1). Walk forward past any already-
      // completed sets so we land on the first undone one.
      //
      // BUT only overwrite when the next undone set still holds the
      // template's default values — i.e. the user hasn't manually edited
      // it. Otherwise re-ticking a prior set would clobber an explicit
      // downstream edit. For ad-hoc added exercises (no baseline item),
      // defaults fall back to 0 / null which is exactly what `addExercise`
      // seeds, so the untouched check still matches the typical case.
      const ex = this.findExercise(client_id);
      if (!ex || !this.active) return;
      const baselineItem = this.active.template_baseline.exercises.find(
        (e) => e.exercise_id === ex.exercise_id,
      );
      const defaultReps = baselineItem?.default_reps ?? 0;
      const defaultWeight = baselineItem?.default_weight_kg ?? null;
      const idx = ex.sets.findIndex((s) => s.set_number === set_number);
      for (let i = idx + 1; i < ex.sets.length; i++) {
        const next = ex.sets[i];
        if (next && !next.done) {
          const isUntouched = next.reps === defaultReps && next.weight_kg === defaultWeight;
          if (isUntouched) {
            next.reps = set.reps;
            next.weight_kg = set.weight_kg;
          }
          break;
        }
      }
      this.persist();
    },

    untickSet(client_id: string, set_number: number): void {
      const set = this.findSet(client_id, set_number);
      if (!set) return;
      set.done = false;
      this.persist();
    },

    editSet(
      client_id: string,
      set_number: number,
      patch: Partial<Pick<ActiveSet, "reps" | "weight_kg">>,
    ): void {
      const set = this.findSet(client_id, set_number);
      if (!set) return;
      if (patch.reps !== undefined) set.reps = patch.reps;
      if (patch.weight_kg !== undefined) set.weight_kg = patch.weight_kg;
      this.persist();
    },

    addSet(client_id: string): void {
      const ex = this.findExercise(client_id);
      if (!ex) return;
      const lastDone = [...ex.sets].reverse().find((s) => s.done);
      const lastAny = ex.sets[ex.sets.length - 1];
      const seedReps = lastDone?.reps ?? lastAny?.reps ?? 0;
      const seedWeight = lastDone?.weight_kg ?? lastAny?.weight_kg ?? null;
      ex.sets.push({
        set_number: ex.sets.length + 1,
        reps: seedReps,
        weight_kg: seedWeight,
        done: false,
      });
      this.persist();
    },

    addExercise(input: { exercise_id: number; name: string; group_id: number }): void {
      if (!this.active) return;
      this.active.exercises.push({
        client_id: nextClientId(),
        exercise_id: input.exercise_id,
        name: input.name,
        group_id: input.group_id,
        added_mid_session: true,
        display_order: this.active.exercises.length + 1,
        baseline_planned_sets: 0,
        skipped: false,
        sets: [{ set_number: 1, reps: 0, weight_kg: null, done: false }],
      });
      this.persist();
    },

    skipExercise(client_id: string): void {
      const ex = this.findExercise(client_id);
      if (!ex) return;
      ex.skipped = true;
      this.persist();
    },

    unskipExercise(client_id: string): void {
      const ex = this.findExercise(client_id);
      if (!ex) return;
      ex.skipped = false;
      this.persist();
    },

    setRpe(rpe: number | null): void {
      if (!this.active) return;
      this.active.rpe = rpe;
      this.persist();
    },

    cancelSession(): void {
      this.active = null;
      clearActiveWorkout();
    },

    async endSession(
      client: ApiClient,
      opts: {
        saveChoice: "all" | "selected" | "none";
        selected_ids?: number[];
        // Positive int minutes. The dialog seeds this from `started_at` and
        // lets the user edit before submit; ActiveView's no-divergences
        // skip-dialog path computes it inline (same formula).
        duration_min: number;
      },
    ): Promise<EndSessionResult> {
      if (!this.active) return { status: "no_active_session" };
      const activeRef = this.active;

      // 0. Partial-failure resume: workout already POSTed durably; only replay
      // the PUT. Spec §7.2: "The workout is not double-posted on retry."
      if (activeRef.pending_template_patch) {
        const workoutId = activeRef.pending_template_patch.workout_id;

        // Recompute divergences from the current state and apply opts as if
        // this were a fresh endSession call.
        const resumeAll = computeDivergences(activeRef.exercises, activeRef.template_baseline);
        const resumeChosen = filterChosenDivergences(resumeAll, opts);

        if (resumeChosen.length === 0 || opts.saveChoice === "none") {
          // User chose to skip the template update this time. Treat as success.
          activeRef.pending_template_patch = undefined;
          this.active = null;
          clearActiveWorkout();
          return { status: "submitted", workout_id: workoutId };
        }

        const newItems = mergeItemsWithDivergences(activeRef.template_baseline, resumeChosen);
        try {
          await client.put(
            `/v1/workout-templates/${activeRef.template_id}/items`,
            { items: newItems },
            WorkoutTemplateResponseSchema,
          );
        } catch (e) {
          if (isApiError(e)) {
            // Still failing — keep the pending flag for another retry.
            return { status: "template_failed", workout_id: workoutId, error: e };
          }
          throw e;
        }

        // PUT finally succeeded.
        this.active = null;
        clearActiveWorkout();
        return { status: "submitted", workout_id: workoutId };
      }

      // 1. Compute divergences.
      const allDivergences = computeDivergences(activeRef.exercises, activeRef.template_baseline);
      const chosen = filterChosenDivergences(allDivergences, opts);

      // 2. Build the workout submission body.
      const body = buildWorkoutBody(activeRef, opts.duration_min);

      // 3. POST /v1/workouts.
      let workoutId: number;
      try {
        const submitted = await client.post("/v1/workouts", body, WorkoutResponseSchema);
        workoutId = submitted.id;
      } catch (e) {
        if (isApiError(e)) {
          activeRef.pending_submit = true;
          this.persist();
          return { status: "workout_failed", error: e };
        }
        throw e;
      }
      // Succeeded if we got here — clear any prior pending_submit flag so a
      // partial-failure retry (template PUT only) doesn't accidentally re-POST.
      activeRef.pending_submit = undefined;

      // 4. Optional template PUT.
      if (chosen.length > 0 && opts.saveChoice !== "none") {
        const newItems = mergeItemsWithDivergences(activeRef.template_baseline, chosen);
        try {
          await client.put(
            `/v1/workout-templates/${activeRef.template_id}/items`,
            { items: newItems },
            WorkoutTemplateResponseSchema,
          );
        } catch (e) {
          if (isApiError(e)) {
            activeRef.pending_template_patch = { workout_id: workoutId };
            this.persist();
            return { status: "template_failed", workout_id: workoutId, error: e };
          }
          throw e;
        }
      }

      // 5. Success — clear localStorage and reset.
      this.active = null;
      clearActiveWorkout();
      return { status: "submitted", workout_id: workoutId };
    },

    persist(): void {
      if (this.active) saveActiveWorkout(this.active);
    },

    findExercise(client_id: string): ActiveExercise | undefined {
      return this.active?.exercises.find((e) => e.client_id === client_id);
    },

    findSet(client_id: string, set_number: number): ActiveSet | undefined {
      return this.findExercise(client_id)?.sets.find((s) => s.set_number === set_number);
    },
  },
});

function makeInitialSets(
  planned_sets: number,
  default_reps: number | null,
  default_weight_kg: number | null,
): ActiveSet[] {
  const out: ActiveSet[] = [];
  for (let i = 0; i < planned_sets; i++) {
    out.push({
      set_number: i + 1,
      reps: default_reps ?? 0,
      weight_kg: default_weight_kg,
      done: false,
    });
  }
  return out;
}

function filterChosenDivergences(
  all: Divergence[],
  opts: { saveChoice: "all" | "selected" | "none"; selected_ids?: number[] },
): Divergence[] {
  if (opts.saveChoice === "none") return [];
  if (opts.saveChoice === "all") return all;
  // "selected": match on exercise_id (good enough for v1 since one divergence
  // per exercise per kind).
  const sel = new Set(opts.selected_ids ?? []);
  return all.filter((d) => sel.has(d.exercise_id));
}

function buildWorkoutBody(active: ActiveWorkout, duration_min: number): unknown {
  // Include every exercise — even skipped/untouched ones. Skipped exercises
  // naturally produce `sets: []` (the `done` filter excludes their sets), and
  // the server's FullWorkout schema records the exercise instance with an
  // empty sets array as "bombed". Per spec §7.2 these still need to land on
  // the session row even though they don't propagate to the template.
  //
  // Known gap: the FullWorkout schema doesn't distinguish "skipped" from
  // "bombed" — both arrive as `sets: []`. Full skip semantics would need the
  // FromTemplate dual-shape with `{op: "skip"}` deviations (a substantial
  // rewrite). Stage 5+ can revisit.
  const exercises = active.exercises
    // Drop added-mid-session exercises with no completed sets — they're
    // an aborted "+ Add exercise" intent and shouldn't reach the server.
    // Matches divergence-diff.ts behavior for the same case.
    .filter((ex) => !(ex.added_mid_session && !ex.sets.some((s) => s.done)))
    .map((ex, idx) => ({
      exercise_id: ex.exercise_id,
      display_order: idx,
      planned_sets: ex.baseline_planned_sets,
      notes: null,
      sets: ex.sets
        .filter((s) => s.done)
        .map((s) => ({
          reps: s.reps,
          weight_kg: s.weight_kg,
          notes: null,
        })),
    }));
  return {
    template_id: active.template_id,
    started_at: active.started_at,
    duration_min,
    rpe: active.rpe,
    exercises,
  };
}

type TemplateItemDraft = {
  exercise_id: number;
  display_order: number;
  default_sets: number;
  default_reps: number | null;
  default_weight_kg: number | null;
  notes: string | null;
};

function mergeItemsWithDivergences(
  baseline: TemplateBaseline,
  divergences: Divergence[],
): TemplateItemDraft[] {
  // Start from baseline items, apply each divergence in turn, return the
  // PUT body shape (WorkoutTemplateItemInputSchema[]).
  const items: TemplateItemDraft[] = baseline.exercises.map((e) => ({
    exercise_id: e.exercise_id,
    display_order: e.display_order,
    default_sets: e.planned_sets,
    default_reps: e.default_reps,
    default_weight_kg: e.default_weight_kg,
    notes: null,
  }));
  for (const d of divergences) {
    if (d.kind === "set_changes") {
      const item = items.find((i) => i.exercise_id === d.exercise_id);
      if (item) {
        if (d.new_default_reps !== null) item.default_reps = d.new_default_reps;
        if (d.new_default_weight_kg !== null) item.default_weight_kg = d.new_default_weight_kg;
      }
    } else if (d.kind === "added_sets") {
      const item = items.find((i) => i.exercise_id === d.exercise_id);
      if (item) item.default_sets = d.new_planned_sets;
    } else if (d.kind === "added_exercise") {
      items.push({
        exercise_id: d.exercise_id,
        display_order: items.length,
        default_sets: d.planned_sets,
        default_reps: d.default_reps,
        default_weight_kg: d.default_weight_kg,
        notes: null,
      });
    }
  }
  return items;
}
