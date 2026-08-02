import { WorkoutResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

// Same wrap-inline pattern as useRecentWorkoutsStore — the list endpoint
// reuses WorkoutResponseSchema element-wise rather than exporting a
// dedicated list schema.
const ListWorkoutsResponseSchema = z.array(WorkoutResponseSchema);

/**
 * Presentation-ready shape for a single past session of a given template.
 *
 * `started_at` plays the role of "completed_at" — Workout has no separate
 * completion timestamp (see recent-workouts.ts for the rationale).
 *
 * `exercise_name` is denormalized client-side via a caller-provided lookup
 * because the workouts API only carries `exercise_id` on each
 * ExerciseInstance — the join happens here, not in the panel component.
 */
export type LastSessionData = {
  workout_id: number;
  started_at: string;
  rpe: number | null;
  exercises: Array<{
    exercise_id: number;
    exercise_name: string;
    skipped: boolean;
    sets: Array<{ reps: number; weight_kg: number | null }>;
  }>;
};

export type TemplateLastSessionEntry =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: LastSessionData | null }
  | { status: "error"; error: ApiError };

export type ExerciseNameLookup = (exerciseId: number) => string;

const IDLE_ENTRY: TemplateLastSessionEntry = { status: "idle" } as const;

export const useTemplateLastSessionsStore = defineStore("template-last-sessions", {
  state: () => ({
    // Pinia state must be plain serializable — use a Record keyed by
    // template_id rather than a Map so devtools snapshotting works.
    entries: {} as Record<number, TemplateLastSessionEntry>,
  }),
  getters: {
    // Returns the entry for a template, or a frozen idle sentinel when no
    // load has been attempted yet. The sentinel must NOT be the same object
    // instance across calls for unrelated templates — Pinia doesn't care,
    // but to keep callers honest we hand back fresh idle records.
    entryFor:
      (state) =>
      (templateId: number): TemplateLastSessionEntry => {
        return state.entries[templateId] ?? IDLE_ENTRY;
      },
  },
  actions: {
    async loadForTemplate(
      client: ApiClient,
      templateId: number,
      exerciseNameLookup: ExerciseNameLookup,
    ): Promise<void> {
      // Short-circuit: once we've either resolved or are mid-flight, don't
      // refetch. Callers that need fresh data (e.g. after a workout submit)
      // go through invalidate()/reloadForTemplate() below.
      const existing = this.entries[templateId];
      if (existing && (existing.status === "ready" || existing.status === "loading")) {
        return;
      }

      this.entries[templateId] = { status: "loading" };

      try {
        // 1. List endpoint — at most one workout for this template. The
        //    workout-level fields suffice to find the id; nested
        //    exercises[] live on the detail endpoint.
        const list = await client.get(
          `/v1/workouts?template_id=${templateId}&limit=1`,
          ListWorkoutsResponseSchema,
        );
        const head = list[0];
        if (!head) {
          this.entries[templateId] = { status: "ready", data: null };
          return;
        }

        // 2. Detail endpoint — pulls nested exercises[] with sets.
        const detail = await client.get(`/v1/workouts/${head.id}`, WorkoutResponseSchema);
        const exerciseInstances = detail.exercises ?? [];

        const exercises = exerciseInstances.map((ex) => ({
          exercise_id: ex.exercise_id,
          exercise_name: exerciseNameLookup(ex.exercise_id),
          skipped: ex.skipped_at !== null,
          sets: (ex.sets ?? []).map((s) => ({
            reps: s.reps,
            weight_kg: s.weight_kg,
          })),
        }));

        this.entries[templateId] = {
          status: "ready",
          data: {
            workout_id: detail.id,
            started_at: detail.started_at,
            // WorkoutResponseSchema.rpe is z.number() so this is always
            // populated, but LastSessionData carries `number | null` to
            // leave the door open for the panel to render "no RPE" if
            // upstream ever loosens the contract.
            rpe: detail.rpe,
            exercises,
          },
        };
      } catch (e) {
        if (isApiError(e)) {
          this.entries[templateId] = { status: "error", error: e };
          return;
        }
        throw e;
      }
    },

    /**
     * Drop the cached entry for a template so the next loadForTemplate call
     * bypasses the short-circuit and re-fetches. Used by post-submit refresh
     * paths (ActiveView.runEnd) so the template's chevron date reflects the
     * just-completed workout.
     */
    invalidate(templateId: number): void {
      delete this.entries[templateId];
    },

    /**
     * Convenience: drop the cached entry and re-fetch in one call. Fire-and-
     * forget from ActiveView after a successful submit.
     */
    async reloadForTemplate(
      client: ApiClient,
      templateId: number,
      exerciseNameLookup: ExerciseNameLookup,
    ): Promise<void> {
      this.invalidate(templateId);
      await this.loadForTemplate(client, templateId, exerciseNameLookup);
    },
  },
});
