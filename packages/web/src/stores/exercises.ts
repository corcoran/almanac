import { ExerciseResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type Exercise = z.infer<typeof ExerciseResponseSchema>;

const ExerciseListResponseSchema = z.array(ExerciseResponseSchema);

export const useExercisesStore = defineStore("exercises", {
  state: () => ({
    status: "idle" as Status,
    exercises: [] as Exercise[],
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        this.exercises = await client.get("/v1/exercises", ExerciseListResponseSchema);
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
  },
});
