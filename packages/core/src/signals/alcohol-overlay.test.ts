import { describe, expect, it } from "vitest";
import { computeAlcoholOverlay } from "./alcohol-overlay.js";

describe("computeAlcoholOverlay", () => {
  const workout = { id: 12, started_at: "2026-05-12T09:00:00Z" };

  it("buckets pre-workout drinks by zone", () => {
    const sessions = [
      // 4h before workout — peak MPS zone
      { started_at: "2026-05-12T05:00:00Z", drinks_count: 1, est_kcal: 150 },
      // 16h before — sleep zone
      { started_at: "2026-05-11T17:00:00Z", drinks_count: 3, est_kcal: 450 },
      // 30h before — recovered zone
      { started_at: "2026-05-11T03:00:00Z", drinks_count: 2, est_kcal: 300 },
      // 60h before — outside 48h, ignored
      { started_at: "2026-05-09T21:00:00Z", drinks_count: 5, est_kcal: 600 },
    ];
    const r = computeAlcoholOverlay(workout, sessions);
    expect(r.drinks_peak_mps_zone).toBe(1);
    expect(r.drinks_sleep_zone).toBe(3);
    expect(r.drinks_recovered_zone).toBe(2);
    expect(r.total_drinks_in_window).toBe(6);
    expect(r.est_kcal_in_window).toBe(900);
  });

  it("zero when no sessions in window", () => {
    const r = computeAlcoholOverlay(workout, []);
    expect(r.total_drinks_in_window).toBe(0);
  });
});
