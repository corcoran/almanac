import { SleepLogResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type SleepLog = z.infer<typeof SleepLogResponseSchema>;

// No dedicated list-response schema is exported from @almanac/core/schemas
// (the list route reuses SleepLogResponseSchema element-wise). Mirror
// recent-workouts.ts / exercises.ts and wrap inline.
const SleepLogListResponseSchema = z.array(SleepLogResponseSchema);

export const useSleepLogsRangeStore = defineStore("sleep-logs-range", {
  state: () => ({
    status: "idle" as Status,
    data: [] as SleepLog[],
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient, fromDate: string, toDate: string): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        const fetched = await client.get(
          `/v1/sleep-logs?from=${fromDate}&to=${toDate}`,
          SleepLogListResponseSchema,
        );
        // API returns ORDER BY slept_on DESC; the histogram renders the
        // array left-to-right, and we want oldest-left / newest-right
        // (today rightmost). Sort by date string ascending so order is
        // guaranteed regardless of upstream changes.
        this.data = [...fetched].sort((a, b) => a.slept_on.localeCompare(b.slept_on));
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
     * Re-fetch the sleep-logs window. Aliases `load` for intent-revealing use
     * by post-submit refresh paths.
     */
    async reload(client: ApiClient, fromDate: string, toDate: string): Promise<void> {
      await this.load(client, fromDate, toDate);
    },
  },
});
