import { DayMacrosRangeResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import type { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

export type IntakeMonthData = z.infer<typeof DayMacrosRangeResponseSchema>;

/** Per-month entry state — same shape as useCalendarStore's entries. */
export type IntakeCalendarEntry =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: IntakeMonthData }
  | { status: "error"; error: ApiError };

const IDLE_ENTRY: IntakeCalendarEntry = { status: "idle" } as const;

/** Last day of a "YYYY-MM" month: day 0 of the NEXT month, UTC noon. */
function lastDayOfMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, monthNum, 0, 12, 0, 0)).toISOString().slice(0, 10);
}

/**
 * Cache of /v1/signals/macros range responses for the intake calendar, one
 * entry per "YYYY-MM" month. The fetch window is [1st, min(last-of-month,
 * today)] — the API has no data past today, and entirely-future months
 * resolve to ready/empty without any HTTP traffic.
 *
 * Deliberately separate from useMacrosRangeStore: that store holds the
 * single 7-day window feeding MacrosWeekGrid, and reusing it here would
 * clobber the week grid whenever the calendar navigates.
 */
export const useIntakeCalendarStore = defineStore("intake-calendar", {
  state: () => ({
    entries: {} as Record<string, IntakeCalendarEntry>,
  }),
  getters: {
    entryFor:
      (state) =>
      (month: string): IntakeCalendarEntry => {
        return state.entries[month] ?? IDLE_ENTRY;
      },
  },
  actions: {
    async loadForMonth(client: ApiClient, month: string, today: string): Promise<void> {
      const existing = this.entries[month];
      if (existing && (existing.status === "ready" || existing.status === "loading")) {
        return;
      }

      const from = `${month}-01`;
      if (from > today) {
        this.entries[month] = { status: "ready", data: { days: [] } };
        return;
      }
      const last = lastDayOfMonth(month);
      const to = last < today ? last : today;

      this.entries[month] = { status: "loading" };
      try {
        const data = await client.get(
          `/v1/signals/macros?from_date=${from}&to_date=${to}`,
          DayMacrosRangeResponseSchema,
        );
        this.entries[month] = { status: "ready", data };
      } catch (e) {
        if (isApiError(e)) {
          this.entries[month] = { status: "error", error: e };
          return;
        }
        throw e;
      }
    },

    /** Drop the cached entry for a month so the next loadForMonth re-fetches. */
    invalidate(month: string): void {
      delete this.entries[month];
    },

    /** Drop the cached entry and re-fetch in one call. `today` clamps the
     *  fetch window exactly as loadForMonth does. */
    async reloadForMonth(client: ApiClient, month: string, today: string): Promise<void> {
      this.invalidate(month);
      await this.loadForMonth(client, month, today);
    },
  },
});
