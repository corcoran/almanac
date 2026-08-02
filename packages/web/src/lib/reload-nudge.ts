import type { ApiClient } from "../api/client.js";

/**
 * Structural type for the next-best-action store — only the `reload` method this
 * helper calls — so the real Pinia store satisfies it without a circular import.
 */
export interface NudgeStore {
  reload(client: ApiClient): Promise<void>;
}

/**
 * Re-fetch the "next steps" nudge after a write.
 *
 * The next-best-action signal (`/v1/signals/next-best-action`) derives from
 * weight, sleep, meals, steps, phase, and workout state — so essentially every
 * write surface can clear or change a nudge (e.g. logging weight resolves the
 * `stale_weight_log` nudge). The store is loaded once at boot and is otherwise
 * only refreshed by the workout end-session path, so without this every other
 * write handler (weight/sleep/meals/phase/cardio/steps) leaves the nudge stale
 * until a full page reload. Centralized here so the set of write handlers that
 * must refresh the nudge can't silently drift apart.
 */
export async function reloadNudge(store: NudgeStore, client: ApiClient): Promise<void> {
  await store.reload(client);
}
