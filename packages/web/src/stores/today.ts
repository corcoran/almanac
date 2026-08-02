import { TodayContextResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import type { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type TodayContext = z.infer<typeof TodayContextResponseSchema>;

export const useTodayStore = defineStore("today", {
  state: () => ({
    status: "idle" as Status,
    data: null as TodayContext | null,
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient, date?: string): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        const path = date ? `/v1/signals/today?date=${date}` : "/v1/signals/today";
        this.data = await client.get(path, TodayContextResponseSchema);
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
    // Thin alias used by post-submit cache invalidation: re-fetch today's
    // context so activity-adjusted kcal targets and week-to-date aggregates
    // reflect the just-completed workout. `load` has no short-circuit, so
    // this just re-runs it.
    async reload(client: ApiClient, date?: string): Promise<void> {
      await this.load(client, date);
    },
  },
});
