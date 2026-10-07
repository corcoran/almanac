import type { ApiClient } from "../api/client.js";
import { type NudgeStore, reloadNudge } from "./reload-nudge.js";
import { daysAgoUserDate, daysAhead } from "./user-day.js";

type DateRange = { from: string; to: string };

type TodayStore = { reload(client: ApiClient, date?: string): Promise<void> };
type RangeStore = { reload(client: ApiClient, from: string, to: string): Promise<void> };

/** `viewedDate` is undefined on the live today view. */
export async function reloadAfterSleepSave(
  stores: { todayStore: TodayStore; sleepLogsStore: RangeStore; nudgeStore: NudgeStore },
  client: ApiClient,
  windows: { viewedDate: string | undefined; sleep: DateRange },
): Promise<void> {
  await Promise.all([
    stores.todayStore.reload(client, windows.viewedDate),
    stores.sleepLogsStore.reload(client, windows.sleep.from, windows.sleep.to),
    reloadNudge(stores.nudgeStore, client),
  ]);
}

/**
 * Steps feed the macros week's STEPS and NET rows, so the macros range
 * reloads too. `viewedDate` is undefined on the live today view.
 */
export async function reloadAfterStepsSave(
  stores: {
    todayStore: TodayStore;
    stepLogsStore: RangeStore;
    macrosStore: RangeStore;
    nudgeStore: NudgeStore;
  },
  client: ApiClient,
  windows: { viewedDate: string | undefined; steps: DateRange; macros: DateRange },
): Promise<void> {
  await Promise.all([
    stores.todayStore.reload(client, windows.viewedDate),
    stores.stepLogsStore.reload(client, windows.steps.from, windows.steps.to),
    stores.macrosStore.reload(client, windows.macros.from, windows.macros.to),
    reloadNudge(stores.nudgeStore, client),
  ]);
}

const SLEEP_CHART_NIGHTS = 14;

/**
 * The nights the sleep chart renders, oldest first, and the sleep-logs range
 * that fetches them (`to` is exclusive, so it's tomorrow). Boot and every
 * reload must use this, or a save refetches a shorter window than the chart.
 */
export function sleepChartWindow(now: Date, tz: string): DateRange & { dates: string[] } {
  const dates = Array.from({ length: SLEEP_CHART_NIGHTS }, (_, i) =>
    daysAgoUserDate(now, SLEEP_CHART_NIGHTS - 1 - i, tz),
  );
  return {
    from: daysAgoUserDate(now, SLEEP_CHART_NIGHTS - 1, tz),
    to: daysAhead(now, 1, tz),
    dates,
  };
}
