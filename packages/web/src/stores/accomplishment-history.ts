import { AccomplishmentHistoryResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import type { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type History = z.infer<typeof AccomplishmentHistoryResponseSchema>;

export const useAccomplishmentHistoryStore = defineStore("accomplishment-history", {
  state: () => ({
    status: "idle" as Status,
    data: null as History | null,
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        this.data = await client.get(
          "/v1/signals/accomplishments/history",
          AccomplishmentHistoryResponseSchema,
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
    async reload(client: ApiClient): Promise<void> {
      await this.load(client);
    },
  },
});
