import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useMacrosRangeStore } from "./macros-range.js";

describe("useMacrosRangeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle", () => {
    const store = useMacrosRangeStore();
    expect(store.status).toBe("idle");
    expect(store.data).toBeNull();
    expect(store.error).toBeNull();
  });

  it("loads 7 days of macros into data when GET succeeds", async () => {
    const fixture = makeMacrosRangeFixture();
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toContain("/v1/signals/macros");
      expect(url).toContain("from_date=2026-05-15");
      expect(url).toContain("to_date=2026-05-21");
      return Promise.resolve(
        new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useMacrosRangeStore();
    const promise = store.load(client, "2026-05-15", "2026-05-21");
    expect(store.status).toBe("loading");
    await promise;
    expect(store.status).toBe("ready");
    expect(store.data).not.toBeNull();
    expect(store.data?.days).toHaveLength(7);
    expect(store.data?.days[0]?.date).toBe("2026-05-15");
  });

  it("transitions to error on HTTP 500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useMacrosRangeStore();
    await store.load(client, "2026-05-15", "2026-05-21");
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });

  it("reload(client, from, to) re-fetches with a fresh response", async () => {
    const first = makeMacrosRangeFixture();
    const second = makeMacrosRangeFixture({ kcal: 9999 });
    let call = 0;
    const fetchImpl = vi.fn(() => {
      const body = call++ === 0 ? first : second;
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useMacrosRangeStore();
    await store.load(client, "2026-05-15", "2026-05-21");
    expect(store.data?.days[0]?.day_totals.kcal).not.toBe(9999);
    await store.reload(client, "2026-05-15", "2026-05-21");
    expect(store.status).toBe("ready");
    expect(store.data?.days[0]?.day_totals.kcal).toBe(9999);
  });
});

// Fixtures assume zero alcohol on every day — the kcal split is just
// kcal_from_food === kcal, kcal_from_alcohol === 0. We attach it via this
// helper so adding fields to DayMacrosTotals later only needs one edit.
function totals(kcal: number, protein_g: number, carb_g: number, fat_g: number) {
  return { kcal, protein_g, carb_g, fat_g, kcal_from_food: kcal, kcal_from_alcohol: 0 };
}

function makeMacrosRangeFixture(opts: { kcal?: number } = {}) {
  const overrideKcal = opts.kcal ?? 2100;

  const makeDayTarget = (k: number) => ({
    target: {
      kcal: 2200,
      protein_g: 180,
      carb_g: 200,
      fat_g: 70,
    },
    maintenance: { kcal: 2200 },
    intake: {
      kcal: k,
      protein_g: 180,
      carb_g: 200,
      fat_g: 70,
    },
    observed: {
      cardio_kcal: 0,
      workout_kcal: 0,
      steps_kcal: 0,
      vs_target: k - 2200,
      vs_maintenance: k - 2200,
      status: "on_track" as const,
    },
  });

  return {
    days: [
      {
        date: "2026-05-15",
        untracked: false,
        day_totals: totals(overrideKcal, 180, 200, 70),
        day_target: makeDayTarget(overrideKcal),
        net_kcal: null,
      },
      {
        date: "2026-05-16",
        untracked: false,
        day_totals: totals(2200, 185, 210, 75),
        day_target: makeDayTarget(2200),
        net_kcal: null,
      },
      {
        date: "2026-05-17",
        untracked: false,
        day_totals: totals(1900, 170, 180, 65),
        day_target: makeDayTarget(1900),
        net_kcal: null,
      },
      {
        date: "2026-05-18",
        untracked: false,
        day_totals: totals(2150, 175, 195, 70),
        day_target: makeDayTarget(2150),
        net_kcal: null,
      },
      {
        date: "2026-05-19",
        untracked: false,
        day_totals: totals(2300, 190, 220, 80),
        day_target: makeDayTarget(2300),
        net_kcal: null,
      },
      {
        date: "2026-05-20",
        untracked: false,
        day_totals: totals(2050, 178, 198, 68),
        day_target: makeDayTarget(2050),
        net_kcal: null,
      },
      {
        date: "2026-05-21",
        untracked: false,
        day_totals: totals(1800, 160, 175, 60),
        day_target: makeDayTarget(1800),
        net_kcal: null,
      },
    ],
  };
}
