import { describe, expect, it } from "vitest";
import { computeDailyTarget } from "./daily-target.js";

describe("computeDailyTarget — new shape", () => {
  const phase = {
    phase_type: "cut" as const,
    tdee_at_phase_start: 2370,
    tdee_source: "user_asserted" as const,
    deficit_kcal: -470,
    daily_kcal_target: 1900,
    base_protein_g: 160,
    base_carb_g: 180,
    base_fat_g: 70,
  };

  const intake = { kcal: 1700, protein_g: 150, carb_g: 170, fat_g: 60 };

  it("returns static target from phase.daily_kcal_target", () => {
    const r = computeDailyTarget({
      phase,
      intake,
      cardio_kcal: 0,
      workout_kcal: 0,
      steps_kcal: 0,
    });
    expect(r.target.kcal).toBe(1900);
    expect(r.target.protein_g).toBe(160);
  });

  it("returns maintenance from phase.tdee_at_phase_start", () => {
    const r = computeDailyTarget({
      phase,
      intake,
      cardio_kcal: 0,
      workout_kcal: 0,
      steps_kcal: 0,
    });
    expect(r.maintenance.kcal).toBe(2370);
  });

  it("surfaces the activity breakdown in observed", () => {
    const r = computeDailyTarget({
      phase,
      intake,
      cardio_kcal: 400,
      workout_kcal: 300,
      steps_kcal: 0,
    });
    expect(r.observed.cardio_kcal).toBe(400);
    expect(r.observed.workout_kcal).toBe(300);
  });

  // Cut phase boundaries (target 1900, TDEE 2370, grace = 237, ceiling = 2137)
  it("cut status: on_track at exact target", () => {
    const r = computeDailyTarget({
      phase,
      intake: { ...intake, kcal: 1900 },
      cardio_kcal: 0,
      workout_kcal: 0,
      steps_kcal: 0,
    });
    expect(r.observed.status).toBe("on_track");
  });

  it("cut status: on_track when intake is within +10% of TDEE grace of target", () => {
    // intake = 2100, target = 1900 (over by 200 — within 237 grace)
    const r = computeDailyTarget({
      phase,
      intake: { ...intake, kcal: 2100 },
      cardio_kcal: 0,
      workout_kcal: 0,
      steps_kcal: 0,
    });
    expect(r.observed.status).toBe("on_track");
  });

  it("cut status: on_track at the exact grace ceiling (target + 10% of TDEE)", () => {
    // 1900 + 237 = 2137 — boundary inclusive
    const r = computeDailyTarget({
      phase,
      intake: { ...intake, kcal: 2137 },
      cardio_kcal: 0,
      workout_kcal: 0,
      steps_kcal: 0,
    });
    expect(r.observed.status).toBe("on_track");
  });

  it("cut status: at_risk one kcal above the grace ceiling", () => {
    const r = computeDailyTarget({
      phase,
      intake: { ...intake, kcal: 2138 },
      cardio_kcal: 0,
      workout_kcal: 0,
      steps_kcal: 0,
    });
    expect(r.observed.status).toBe("at_risk");
  });

  it("cut status: at_risk just under maintenance", () => {
    const r = computeDailyTarget({
      phase,
      intake: { ...intake, kcal: 2369 },
      cardio_kcal: 0,
      workout_kcal: 0,
      steps_kcal: 0,
    });
    expect(r.observed.status).toBe("at_risk");
  });

  it("cut status: off_track at maintenance (exact TDEE)", () => {
    const r = computeDailyTarget({
      phase,
      intake: { ...intake, kcal: 2370 },
      cardio_kcal: 0,
      workout_kcal: 0,
      steps_kcal: 0,
    });
    expect(r.observed.status).toBe("off_track");
  });

  it("cut status: off_track when intake exceeds maintenance", () => {
    const r = computeDailyTarget({
      phase,
      intake: { ...intake, kcal: 2400 },
      cardio_kcal: 0,
      workout_kcal: 0,
      steps_kcal: 0,
    });
    expect(r.observed.status).toBe("off_track");
  });

  describe("bulk phase", () => {
    // Bulk: target 2670, TDEE 2370, grace = 237, floor = 2433
    const bulk = {
      ...phase,
      phase_type: "bulk" as const,
      deficit_kcal: 300,
      daily_kcal_target: 2670,
    };

    it("on_track at exact target", () => {
      const r = computeDailyTarget({
        phase: bulk,
        intake: { ...intake, kcal: 2700 },
        cardio_kcal: 0,
        workout_kcal: 0,
        steps_kcal: 0,
      });
      expect(r.observed.status).toBe("on_track");
    });

    it("on_track when intake is within -10% of TDEE grace of target", () => {
      // intake = 2500, target = 2670 (short by 170 — within 237 grace)
      const r = computeDailyTarget({
        phase: bulk,
        intake: { ...intake, kcal: 2500 },
        cardio_kcal: 0,
        workout_kcal: 0,
        steps_kcal: 0,
      });
      expect(r.observed.status).toBe("on_track");
    });

    it("on_track at the exact grace floor (target - 10% of TDEE)", () => {
      // 2670 - 237 = 2433 — boundary inclusive
      const r = computeDailyTarget({
        phase: bulk,
        intake: { ...intake, kcal: 2433 },
        cardio_kcal: 0,
        workout_kcal: 0,
        steps_kcal: 0,
      });
      expect(r.observed.status).toBe("on_track");
    });

    it("at_risk one kcal below the grace floor", () => {
      const r = computeDailyTarget({
        phase: bulk,
        intake: { ...intake, kcal: 2432 },
        cardio_kcal: 0,
        workout_kcal: 0,
        steps_kcal: 0,
      });
      expect(r.observed.status).toBe("at_risk");
    });

    it("at_risk just over maintenance", () => {
      const r = computeDailyTarget({
        phase: bulk,
        intake: { ...intake, kcal: 2371 },
        cardio_kcal: 0,
        workout_kcal: 0,
        steps_kcal: 0,
      });
      expect(r.observed.status).toBe("at_risk");
    });

    it("off_track at maintenance (exact TDEE)", () => {
      const r = computeDailyTarget({
        phase: bulk,
        intake: { ...intake, kcal: 2370 },
        cardio_kcal: 0,
        workout_kcal: 0,
        steps_kcal: 0,
      });
      expect(r.observed.status).toBe("off_track");
    });

    it("off_track when intake is below maintenance", () => {
      const r = computeDailyTarget({
        phase: bulk,
        intake: { ...intake, kcal: 2300 },
        cardio_kcal: 0,
        workout_kcal: 0,
        steps_kcal: 0,
      });
      expect(r.observed.status).toBe("off_track");
    });
  });

  describe("maintenance phase", () => {
    const maint = {
      ...phase,
      phase_type: "maintenance" as const,
      deficit_kcal: 0,
      daily_kcal_target: 2370,
    };

    it("on_track when |intake - target| <= 5% of target", () => {
      const r = computeDailyTarget({
        phase: maint,
        intake: { ...intake, kcal: 2400 },
        cardio_kcal: 0,
        workout_kcal: 0,
        steps_kcal: 0,
      });
      expect(r.observed.status).toBe("on_track");
    });

    it("off_track outside the ±5% band", () => {
      const r = computeDailyTarget({
        phase: maint,
        intake: { ...intake, kcal: 2600 },
        cardio_kcal: 0,
        workout_kcal: 0,
        steps_kcal: 0,
      });
      expect(r.observed.status).toBe("off_track");
    });

    it("off_track at target + 200 (tighter than the cut/bulk grace band)", () => {
      // 5% of 2370 target = 118.5; 200 > 118.5 → off_track even though
      // it would be on_track in a cut/bulk phase (10% of TDEE = 237).
      const r = computeDailyTarget({
        phase: maint,
        intake: { ...intake, kcal: 2570 },
        cardio_kcal: 0,
        workout_kcal: 0,
        steps_kcal: 0,
      });
      expect(r.observed.status).toBe("off_track");
    });
  });

  describe("steps_kcal", () => {
    it("surfaces steps_kcal in observed", () => {
      const r = computeDailyTarget({
        phase,
        intake,
        cardio_kcal: 100,
        workout_kcal: 200,
        steps_kcal: 300,
      });
      expect(r.observed.steps_kcal).toBe(300);
    });

    it("treats steps_kcal=0 the same as no steps", () => {
      const r = computeDailyTarget({
        phase,
        intake,
        cardio_kcal: 100,
        workout_kcal: 200,
        steps_kcal: 0,
      });
      expect(r.observed.steps_kcal).toBe(0);
    });
  });
});
