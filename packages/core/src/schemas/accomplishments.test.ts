import { describe, expect, it } from "vitest";
import {
  AccomplishmentCodeSchema,
  AccomplishmentHistoryResponseSchema,
  AccomplishmentSchema,
  AccomplishmentsResponseSchema,
} from "./accomplishments.js";

describe("AccomplishmentSchema", () => {
  it("accepts a weigh_in_streak win with prior_best", () => {
    const parsed = AccomplishmentSchema.parse({
      code: "weigh_in_streak",
      earned_on: "2026-05-21",
      value: 14,
      message: "14-day weigh-in streak",
      details: { streak_days: 14 },
      prior_best: { earned_on: "2026-05-01", value: 10 },
    });
    expect(parsed.code).toBe("weigh_in_streak");
  });

  it("accepts a tdee_measured win with null prior_best", () => {
    const parsed = AccomplishmentSchema.parse({
      code: "tdee_measured",
      earned_on: "2026-05-21",
      value: 0,
      message: "TDEE now measured from your data",
      details: {},
      prior_best: null,
    });
    expect(parsed.prior_best).toBeNull();
  });

  it("wraps wins in a response object", () => {
    const r = AccomplishmentsResponseSchema.parse({ accomplishments: [] });
    expect(r.accomplishments).toEqual([]);
  });

  it("rejects an unknown code", () => {
    expect(() =>
      AccomplishmentSchema.parse({
        code: "unknown_win",
        earned_on: "2026-05-21",
        value: 1,
        message: "x",
        details: {},
        prior_best: null,
      }),
    ).toThrow();
  });

  it("rejects a malformed earned_on date", () => {
    expect(() =>
      AccomplishmentSchema.parse({
        code: "weigh_in_streak",
        earned_on: "2026/05/21",
        value: 1,
        message: "x",
        details: {},
        prior_best: null,
      }),
    ).toThrow();
  });

  it("accepts the lifetime/volume total codes", () => {
    for (const code of ["workout_total", "volume_total", "meal_total", "weigh_in_total"]) {
      expect(AccomplishmentCodeSchema.parse(code)).toBe(code);
    }
  });

  it("accepts a strength_pr win", () => {
    const parsed = AccomplishmentSchema.parse({
      code: "strength_pr",
      earned_on: "2026-06-08",
      value: 96.5,
      message: "New PR: Bench Press e1RM 96.5 kg",
      details: {
        exercise_id: 3,
        exercise_name: "Bench Press",
        weight_kg: 82.5,
        reps: 5,
        prior_e1rm: 93.5,
      },
      prior_best: { earned_on: "2026-05-01", value: 93.5 },
    });
    expect(parsed.code).toBe("strength_pr");
  });
});

describe("AccomplishmentHistoryResponseSchema", () => {
  it("AccomplishmentHistoryResponseSchema accepts a timeline with aggregates", () => {
    const parsed = AccomplishmentHistoryResponseSchema.parse({
      accomplishments: [
        {
          code: "weigh_in_streak",
          earned_on: "2026-06-01",
          value: 14,
          message: "14-day weigh-in streak",
          details: { streak_days: 14 },
          prior_best: { earned_on: "2026-05-01", value: 7 },
        },
      ],
      aggregates: {
        total: 1,
        by_type: {
          weigh_in_streak: 1,
          workout_consistency: 0,
          target_adherence_streak: 0,
          weight_milestone: 0,
          tdee_measured: 0,
          strength_pr: 0,
          phase_complete: 0,
          phase_halfway: 0,
          workout_total: 0,
          volume_total: 0,
          meal_total: 0,
          weigh_in_total: 0,
          sleep_recovery: 0,
        },
        best_by_type: {
          weigh_in_streak: { value: 14, earned_on: "2026-06-01" },
          workout_consistency: null,
          target_adherence_streak: null,
          weight_milestone: null,
          tdee_measured: null,
          strength_pr: null,
          phase_complete: null,
          phase_halfway: null,
          workout_total: null,
          volume_total: null,
          meal_total: null,
          weigh_in_total: null,
          sleep_recovery: null,
        },
      },
    });
    expect(parsed.aggregates.total).toBe(1);
    expect(parsed.aggregates.best_by_type.weigh_in_streak?.value).toBe(14);
  });
});
