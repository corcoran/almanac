import { CalendarResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import type { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

export type CalendarData = z.infer<typeof CalendarResponseSchema>;

/**
 * Per-month entry state. Mirrors the per-key cache pattern from
 * useTemplateLastSessionsStore — same idle/loading/ready/error discriminated
 * union, keyed by "YYYY-MM" string instead of template id.
 */
export type CalendarEntry =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: CalendarData }
  | { status: "error"; error: ApiError };

const IDLE_ENTRY: CalendarEntry = { status: "idle" } as const;

/**
 * Cache of /v1/calendar?month=YYYY-MM responses, one entry per month.
 * MonthCalendar.vue navigates prev/next by mutating its month ref, which
 * triggers loadForMonth — already-fetched months hit the cache (instant
 * navigation back); never-seen months go through loading → ready.
 *
 * Post-submit refresh paths (e.g. workout completion) call invalidate or
 * reloadForMonth on the current month so newly-recorded sessions appear
 * as past-session chips without a hard reload.
 */
export const useCalendarStore = defineStore("calendar", {
  state: () => ({
    // Plain Record keyed by month string so Pinia devtools can snapshot.
    entries: {} as Record<string, CalendarEntry>,
  }),
  getters: {
    entryFor:
      (state) =>
      (month: string): CalendarEntry => {
        return state.entries[month] ?? IDLE_ENTRY;
      },
  },
  actions: {
    async loadForMonth(client: ApiClient, month: string): Promise<void> {
      // Short-circuit: don't re-fetch a month that's already resolved or
      // mid-flight. Callers that want fresh data go through
      // invalidate()/reloadForMonth() below.
      const existing = this.entries[month];
      if (existing && (existing.status === "ready" || existing.status === "loading")) {
        return;
      }

      this.entries[month] = { status: "loading" };

      try {
        const data = await client.get(`/v1/calendar?month=${month}`, CalendarResponseSchema);
        this.entries[month] = { status: "ready", data };
      } catch (e) {
        if (isApiError(e)) {
          this.entries[month] = { status: "error", error: e };
          return;
        }
        throw e;
      }
    },

    /**
     * Drop the cached entry for a month so the next loadForMonth call
     * bypasses the short-circuit and re-fetches. Used by post-submit
     * refresh paths after a workout is logged.
     */
    invalidate(month: string): void {
      delete this.entries[month];
    },

    /**
     * Convenience: drop the cached entry and re-fetch in one call.
     */
    async reloadForMonth(client: ApiClient, month: string): Promise<void> {
      this.invalidate(month);
      await this.loadForMonth(client, month);
    },
  },
});
