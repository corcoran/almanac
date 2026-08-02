import { DailyBalanceSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import type { z } from "zod";
import type { ApiClient } from "../api/client.js";

type Balance = z.infer<typeof DailyBalanceSchema>;

export const useLlmUsageStore = defineStore("llmUsage", {
  state: () => ({ balance: null as Balance | null }),
  actions: {
    /**
     * Fetch today's balance for one chat surface. The `feature` scopes the
     * "logs left" per-log cost to that panel (meal-chat ~1k tokens vs insights
     * ~5k); the shared daily budget is the same either way. Silently no-ops on
     * error (feature disabled / offline) so the indicator just hides.
     */
    async refresh(client: ApiClient, feature: "meal_chat" | "insights_chat"): Promise<void> {
      try {
        this.balance = await client.get(`/v1/llm/usage?feature=${feature}`, DailyBalanceSchema);
      } catch {
        this.balance = null;
      }
    },
  },
});
