import { MealResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type Meal = z.infer<typeof MealResponseSchema>;

// No dedicated list-response schema is exported from @almanac/core/schemas
// (the list route reuses MealResponseSchema element-wise). Mirror
// sleep-logs-range.ts / body-weights-range.ts and wrap inline.
const MealListResponseSchema = z.array(MealResponseSchema);

export const useMealsStore = defineStore("meals", {
  state: () => ({
    status: "idle" as Status,
    data: [] as Meal[],
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient, fromDate: string, toDate: string): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        const fetched = await client.get(
          `/v1/meals?from_date=${fromDate}&to_date=${toDate}`,
          MealListResponseSchema,
        );
        // API returns ORDER BY eaten_at DESC; the MealsList view renders
        // entries top-to-bottom chronologically (oldest first per user
        // preference — see what you ate at breakfast before lunch before
        // dinner). Sort by `eaten_at` ascending so order is guaranteed
        // regardless of upstream changes.
        this.data = [...fetched].sort((a, b) => a.eaten_at.localeCompare(b.eaten_at));
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
     * Re-fetch the meals window. Aliases `load` for intent-revealing use by
     * post-submit refresh paths (though no current submit path touches meals
     * — keeping the symmetry with sibling range stores).
     */
    async reload(client: ApiClient, fromDate: string, toDate: string): Promise<void> {
      await this.load(client, fromDate, toDate);
    },
  },
});
