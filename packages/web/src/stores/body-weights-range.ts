import { BodyWeightResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type BodyWeight = z.infer<typeof BodyWeightResponseSchema>;

// No dedicated list-response schema is exported from @almanac/core/schemas
// (the list route reuses BodyWeightResponseSchema element-wise). Mirror
// recent-workouts.ts / exercises.ts and wrap inline.
const BodyWeightListResponseSchema = z.array(BodyWeightResponseSchema);

export const useBodyWeightsRangeStore = defineStore("body-weights-range", {
  state: () => ({
    status: "idle" as Status,
    data: [] as BodyWeight[],
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient, fromDate: string, toDate: string): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        const fetched = await client.get(
          `/v1/body-weights?from=${fromDate}&to=${toDate}`,
          BodyWeightListResponseSchema,
        );
        // API returns ORDER BY measured_on DESC; chart consumers expect
        // oldest-left / newest-right (today rightmost on the sparkline).
        // Sort by date string ascending so the array is always in
        // chronological order regardless of upstream changes.
        this.data = [...fetched].sort((a, b) => a.measured_on.localeCompare(b.measured_on));
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
     * Re-fetch the body-weights window. Aliases `load` for intent-revealing
     * use by post-submit refresh paths.
     */
    async reload(client: ApiClient, fromDate: string, toDate: string): Promise<void> {
      await this.load(client, fromDate, toDate);
    },
  },
});
