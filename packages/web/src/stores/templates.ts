import {
  RecommendTemplateResponseSchema,
  WorkoutTemplateResponseSchema,
} from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type WorkoutTemplate = z.infer<typeof WorkoutTemplateResponseSchema>;

const WorkoutTemplateListResponseSchema = z.array(WorkoutTemplateResponseSchema);

export const useTemplatesStore = defineStore("templates", {
  state: () => ({
    status: "idle" as Status,
    templates: [] as WorkoutTemplate[],
    recommended_template_id: null as number | null,
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        const [templates, recommend] = await Promise.all([
          client.get("/v1/workout-templates", WorkoutTemplateListResponseSchema),
          client.get("/v1/signals/recommend-template", RecommendTemplateResponseSchema),
        ]);
        this.templates = templates;
        this.recommended_template_id = recommend.recommendations[0]?.template_id ?? null;
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
    // Thin alias used by post-submit cache invalidation: re-fetch templates +
    // recommendation so `recommended_template_id` reflects the just-completed
    // session. `load` has no short-circuit, so this just re-runs it.
    async reload(client: ApiClient): Promise<void> {
      await this.load(client);
    },
  },
});
