import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import {
  reloadAfterSleepSave,
  reloadAfterStepsSave,
  sleepChartWindow,
} from "./reload-after-log.js";

const client = {} as ApiClient;
const range = (from: string, to: string) => ({ from, to });

describe("reloadAfterSleepSave", () => {
  it("reloads today (for the viewed day), sleep logs, and the nudge", async () => {
    const stores = {
      todayStore: { reload: vi.fn(async () => {}) },
      sleepLogsStore: { reload: vi.fn(async () => {}) },
      nudgeStore: { reload: vi.fn(async () => {}) },
    };
    await reloadAfterSleepSave(stores, client, {
      viewedDate: "2026-10-03",
      sleep: range("2026-09-24", "2026-10-08"),
    });
    expect(stores.todayStore.reload).toHaveBeenCalledWith(client, "2026-10-03");
    expect(stores.sleepLogsStore.reload).toHaveBeenCalledWith(client, "2026-09-24", "2026-10-08");
    expect(stores.nudgeStore.reload).toHaveBeenCalledWith(client);
  });
});

describe("reloadAfterStepsSave", () => {
  it("reloads today, the steps chart, the macros week (STEPS and NET rows), and the nudge", async () => {
    const stores = {
      todayStore: { reload: vi.fn(async () => {}) },
      stepLogsStore: { reload: vi.fn(async () => {}) },
      macrosStore: { reload: vi.fn(async () => {}) },
      nudgeStore: { reload: vi.fn(async () => {}) },
    };
    await reloadAfterStepsSave(stores, client, {
      viewedDate: undefined,
      steps: range("2026-09-23", "2026-10-07"),
      macros: range("2026-10-01", "2026-10-07"),
    });
    expect(stores.todayStore.reload).toHaveBeenCalledWith(client, undefined);
    expect(stores.stepLogsStore.reload).toHaveBeenCalledWith(client, "2026-09-23", "2026-10-07");
    expect(stores.macrosStore.reload).toHaveBeenCalledWith(client, "2026-10-01", "2026-10-07");
    expect(stores.nudgeStore.reload).toHaveBeenCalledWith(client);
  });
});

describe("sleepChartWindow", () => {
  it("covers the 14 nights the chart renders, through tonight", () => {
    // 10:00 EDT Oct 7
    const w = sleepChartWindow(new Date("2026-10-07T14:00:00Z"), "America/Toronto");
    expect(w.dates).toHaveLength(14);
    expect(w.dates[0]).toBe("2026-09-24");
    expect(w.dates[13]).toBe("2026-10-07");
    expect(w.from).toBe("2026-09-24");
    // The sleep-logs range `to` is exclusive.
    expect(w.to).toBe("2026-10-08");
  });
});
