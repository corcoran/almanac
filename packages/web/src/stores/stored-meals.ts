import { StoredMealListItemSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

type Status = "idle" | "loading" | "ready" | "error";
type StoredMeal = z.infer<typeof StoredMealListItemSchema>;

const StoredMealListResponseSchema = z.array(StoredMealListItemSchema);
const RECENT_LIMIT = 10;

function byRecentUse(a: StoredMeal, b: StoredMeal): number {
  return (
    b.recent_uses - a.recent_uses ||
    (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "") ||
    a.name.localeCompare(b.name)
  );
}

export const useStoredMealsStore = defineStore("storedMeals", {
  state: () => ({
    status: "idle" as Status,
    data: [] as StoredMeal[],
    error: null as ApiError | null,
    expanded: false,
  }),
  getters: {
    recent(state): StoredMeal[] {
      return state.data
        .filter((m) => m.recent_uses > 0)
        .sort(byRecentUse)
        .slice(0, RECENT_LIMIT);
    },
    rest(): StoredMeal[] {
      const recentIds = new Set(this.recent.map((m) => m.id));
      return this.data.filter((m) => !recentIds.has(m.id));
    },
  },
  actions: {
    toggleExpanded(): void {
      this.expanded = !this.expanded;
    },
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
