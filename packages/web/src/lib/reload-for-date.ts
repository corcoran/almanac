import type { ApiClient } from "../api/client.js";

/**
 * The per-day stores that must re-fetch when the user navigates to a different
 * calendar day (calendar traversal). Typed structurally — only the methods this
 * helper calls — so the real Pinia stores satisfy it without a circular import.
 */
export interface ViewedDayStores {
  todayStore: { reload(client: ApiClient, date?: string): Promise<void> };
  mealsStore: { load(client: ApiClient, fromDate: string, toDate: string): Promise<void> };
}

/**
 * Reload everything keyed to the viewed calendar day.
 *
 * - `todayStore`: pass `date` for a past day, or `undefined` when the viewed day
 *   IS today so it hits the live `/v1/signals/today` (matches the canonical
 *   "today" view rather than `?date=today`).
 * - `mealsStore`: `/v1/meals?from_date=X&to_date=X` resolves to a single
 *   user-day window, so load `(date, date)` for the viewed day. This is the
 *   regression fix — the meals store was previously only loaded once at boot
 *   (pinned to today) and never reloaded on date change.
 */
export async function reloadForViewedDate(
  stores: ViewedDayStores,
  client: ApiClient,
  date: string,
  realToday: string,
): Promise<void> {
  await Promise.all([
    stores.todayStore.reload(client, date === realToday ? undefined : date),
    stores.mealsStore.load(client, date, date),
  ]);
}
