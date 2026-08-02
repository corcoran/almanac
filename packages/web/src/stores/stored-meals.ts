import { StoredMealResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type StoredMeal = z.infer<typeof StoredMealResponseSchema>;

const StoredMealListResponseSchema = z.array(StoredMealResponseSchema);

export const useStoredMealsStore = defineStore("storedMeals", {
  state: () => ({
    status: "idle" as Status,
    data: [] as StoredMeal[],
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        const fetched = await client.get("/v1/stored-meals", StoredMealListResponseSchema);
        // The list route already orders by name; sort client-side too for a
        // stable display order regardless of upstream changes.
        this.data = [...fetched].sort((a, b) => a.name.localeCompare(b.name));
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
