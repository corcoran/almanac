import { StepLogResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type StepLog = z.infer<typeof StepLogResponseSchema>;

const StepLogListResponseSchema = z.array(StepLogResponseSchema);

export const useStepLogsRangeStore = defineStore("step-logs-range", {
  state: () => ({
    status: "idle" as Status,
    data: [] as StepLog[],
    error: null as ApiError | null,
  }),
  actions: {
    /** `toDate` is exclusive. Data is sorted oldest first. */
    async load(client: ApiClient, fromDate: string, toDate: string): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        const fetched = await client.get(
          `/v1/step-logs?from=${fromDate}&to=${toDate}`,
          StepLogListResponseSchema,
        );
        this.data = [...fetched].sort((a, b) => a.on_date.localeCompare(b.on_date));
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

    async reload(client: ApiClient, fromDate: string, toDate: string): Promise<void> {
      await this.load(client, fromDate, toDate);
    },
  },
});
