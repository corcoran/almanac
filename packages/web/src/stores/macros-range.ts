import { DayMacrosRangeResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import type { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type MacrosRange = z.infer<typeof DayMacrosRangeResponseSchema>;

export const useMacrosRangeStore = defineStore("macros-range", {
  state: () => ({
    status: "idle" as Status,
    data: null as MacrosRange | null,
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient, fromDate: string, toDate: string): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        this.data = await client.get(
          `/v1/signals/macros?from_date=${fromDate}&to_date=${toDate}`,
          DayMacrosRangeResponseSchema,
        );
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
     * Re-fetch the macros range with the same (or different) window. Aliases
     * `load` since `load` has no cache short-circuit; this is intent-revealing
     * for post-submit refresh paths.
     */
    async reload(client: ApiClient, fromDate: string, toDate: string): Promise<void> {
      await this.load(client, fromDate, toDate);
    },
  },
});
