import { NextBestActionResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import type { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type NextBestAction = z.infer<typeof NextBestActionResponseSchema>;

export const useNextBestActionStore = defineStore("nextBestAction", {
  state: () => ({
    status: "idle" as Status,
    data: null as NextBestAction | null,
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        this.data = await client.get("/v1/signals/next-best-action", NextBestActionResponseSchema);
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
    // Completing a workout clears the `no_workout_streak` nudge, so the
    // summary must re-fetch to reflect the updated next-best-action state.
    async reload(client: ApiClient): Promise<void> {
      await this.load(client);
    },
  },
});
