import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { reloadForViewedDate } from "./reload-for-date.js";

/**
 * The selectedDate watcher in App.vue reloads the per-day stores when the user
 * navigates to a different calendar day. Regression target: BEFORE this fix the
 * meals store was loaded once at boot (pinned to today) and never reloaded on
 * date change, so switching days left the meals list stale while the rest of the
 * dashboard updated. This helper centralizes "reload everything keyed to the
 * viewed day" so the behavior is testable.
 */

function makeStores() {
  return {
    todayStore: { reload: vi.fn(async () => {}) },
    mealsStore: { load: vi.fn(async () => {}) },
  };
}

const client = {} as ApiClient;

describe("reloadForViewedDate", () => {
  it("reloads meals for the viewed day's single-day window", async () => {
    const stores = makeStores();
    await reloadForViewedDate(stores, client, "2026-06-10", "2026-06-15");
    // /v1/meals?from_date=X&to_date=X resolves to a single user-day window.
    expect(stores.mealsStore.load).toHaveBeenCalledWith(client, "2026-06-10", "2026-06-10");
  });

  it("reloads the today payload for the viewed day when it is a PAST day", async () => {
    const stores = makeStores();
    await reloadForViewedDate(stores, client, "2026-06-10", "2026-06-15");
    expect(stores.todayStore.reload).toHaveBeenCalledWith(client, "2026-06-10");
  });

  it("reloads the today payload with no date arg when the viewed day IS today", async () => {
    const stores = makeStores();
    await reloadForViewedDate(stores, client, "2026-06-15", "2026-06-15");
    // Passing undefined hits /v1/signals/today (live), not ?date= — matches the
    // prior watcher behavior so returning to today is the canonical live view.
    expect(stores.todayStore.reload).toHaveBeenCalledWith(client, undefined);
  });

  it("still reloads meals for today's window when the viewed day IS today", async () => {
    const stores = makeStores();
    await reloadForViewedDate(stores, client, "2026-06-15", "2026-06-15");
    expect(stores.mealsStore.load).toHaveBeenCalledWith(client, "2026-06-15", "2026-06-15");
  });
});
