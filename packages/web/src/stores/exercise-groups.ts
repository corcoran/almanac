import { ExerciseGroupResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type ExerciseGroup = z.infer<typeof ExerciseGroupResponseSchema>;

const ExerciseGroupListResponseSchema = z.array(ExerciseGroupResponseSchema);

export const useExerciseGroupsStore = defineStore("exercise-groups", {
  state: () => ({
    status: "idle" as Status,
    groups: [] as ExerciseGroup[],
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        this.groups = await client.get("/v1/exercise-groups", ExerciseGroupListResponseSchema);
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
