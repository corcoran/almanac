import { WorkoutResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";

// No dedicated list-response schema is exported from @almanac/core/schemas
// (the list route reuses WorkoutResponseSchema element-wise). Mirror Task
// 2.3's pattern and wrap inline.
const ListWorkoutsResponseSchema = z.array(WorkoutResponseSchema);

/**
 * The derived, presentation-ready shape consumed by IdleView.
 *
 * `started_at` plays the role the spec calls "completed_at" — there's no
 * separate completion timestamp on Workout (see tests/scripts/13-web-idle/
 * last-session-shape.sh for the rationale). exercise_count and set_count
 * are derived from the detail endpoint's nested exercises[], dropping
 * skipped rows to match the stim signal's policy.
 */
export type RecentWorkoutData = {
  id: number;
  template_id: number | null;
  started_at: string;
  exercise_count: number;
  set_count: number;
};

export const useRecentWorkoutsStore = defineStore("recent-workouts", {
  state: () => ({
    status: "idle" as Status,
    data: null as RecentWorkoutData | null,
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        // 1. List endpoint — workout-level fields only, no nested exercises[].
        const list = await client.get("/v1/workouts?limit=1", ListWorkoutsResponseSchema);
        const head = list[0];
        if (!head) {
          this.data = null;
          this.status = "ready";
          return;
        }

        // 2. Detail endpoint — returns nested exercises[] needed for counts.
        const detail = await client.get(`/v1/workouts/${head.id}`, WorkoutResponseSchema);
        const exercises = detail.exercises ?? [];
        const nonSkipped = exercises.filter((ex) => ex.skipped_at === null);
        const exerciseCount = nonSkipped.length;
        const setCount = nonSkipped.reduce((acc, ex) => acc + (ex.sets?.length ?? 0), 0);

        this.data = {
          id: head.id,
          template_id: head.template_id,
          started_at: head.started_at,
          exercise_count: exerciseCount,
          set_count: setCount,
        };
        this.status = "ready";
      } catch (e) {
        if (isApiError(e)) {
          this.error = e;
          this.status = "error";
          return;
        }
        throw e;
      }
    },

    /**
     * Re-fetch the "most recent workout" snapshot. `load` already has no
     * cache short-circuit (it re-fetches on every call), so this is an
     * intent-revealing alias used by post-submit refresh paths like
     * ActiveView.runEnd.
     */
    async reload(client: ApiClient): Promise<void> {
      await this.load(client);
    },
  },
});
