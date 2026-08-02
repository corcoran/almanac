import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  idempotencyKey,
  statusPhrase,
  summarizeAccomplishment,
  summarizeAccomplishmentAggregates,
  summarizeAlcohol,
  summarizeCardio,
  summarizeMeal,
  summarizeSleep,
  summarizeWeight,
  summarizeWorkout,
} from "./format.js";

describe("canonicalJson", () => {
  it("sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { b: 1, a: 2 }, a: 1 })).toBe('{"a":1,"z":{"a":2,"b":1}}');
  });

  it("handles arrays positionally", () => {
    expect(canonicalJson([1, 2, 3])).toBe("[1,2,3]");
    expect(canonicalJson({ x: [{ b: 1, a: 2 }] })).toBe('{"x":[{"a":2,"b":1}]}');
  });

  it("two payloads with same content + different key order produce identical strings", () => {
    const a = { kcal: 350, protein_g: 25, carb_g: 30 };
    const b = { protein_g: 25, carb_g: 30, kcal: 350 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});

describe("idempotencyKey", () => {
  it("produces stable hashes for equivalent payloads", () => {
    const a = idempotencyKey("meal", 1, { kcal: 350, protein_g: 25 });
    const b = idempotencyKey("meal", 1, { protein_g: 25, kcal: 350 });
    expect(a).toBe(b);
  });

  it("changes the hash when any field differs", () => {
    const a = idempotencyKey("meal", 1, { kcal: 350, protein_g: 25 });
    const b = idempotencyKey("meal", 1, { kcal: 351, protein_g: 25 });
    expect(a).not.toBe(b);
  });

  it("includes resource + user id as prefix so cross-resource keys can't collide", () => {
    const a = idempotencyKey("meal", 1, { x: 1 });
    const b = idempotencyKey("cardio", 1, { x: 1 });
    const c = idempotencyKey("meal", 2, { x: 1 });
    expect(a.startsWith("meal:1:")).toBe(true);
    expect(b.startsWith("cardio:1:")).toBe(true);
    expect(c.startsWith("meal:2:")).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("summarizeMeal", () => {
  it("formats kcal/macros and day-total percentage with the day label", () => {
    const meal = { id: 1, kcal: 350, protein_g: 25, carb_g: 30, fat_g: 15 };
    const s = summarizeMeal(meal, "2026-05-08", 1100, 1900);
    expect(s).toContain("350 kcal");
    expect(s).toContain("25p");
    expect(s).toContain("1100/1900");
    expect(s).toContain("58%");
    expect(s).toContain("2026-05-08");
    expect(s).not.toContain("Today");
  });
});

describe("summarizeWorkout", () => {
  it("summarizeWorkout reports N/M plus skipped count when template-driven", () => {
    const w = {
      id: 1,
      rpe: 7,
      template_id: 3,
      exercises: [
        { exercise_id: 10, sets: [{ reps: 8 }], skipped_at: null },
        { exercise_id: 11, sets: [{ reps: 8 }], skipped_at: null },
        { exercise_id: 12, sets: [], skipped_at: "2026-05-08T20:00:00Z" },
      ],
    };
    expect(summarizeWorkout(w)).toBe("Logged workout — RPE 7, 2/3 exercises (1 skipped).");
  });

  it("summarizeWorkout reports plain count when no template", () => {
    const w = {
      id: 1,
      rpe: 7,
      template_id: null,
      exercises: [{ exercise_id: 10, sets: [{ reps: 8 }], skipped_at: null }],
    };
    expect(summarizeWorkout(w)).toBe("Logged workout — RPE 7, 1 exercise.");
  });

  it("summarizeWorkout reports 'N/N exercises' (no skipped clause) when all exercises completed", () => {
    const w = {
      id: 1,
      rpe: 7,
      template_id: 3,
      exercises: [
        { exercise_id: 10, sets: [{ reps: 8 }], skipped_at: null },
        { exercise_id: 11, sets: [{ reps: 8 }], skipped_at: null },
      ],
    };
    expect(summarizeWorkout(w)).toBe("Logged workout — RPE 7, 2/2 exercises.");
  });

  it("summarizeWorkout reports plural correctly", () => {
    const w = { id: 1, rpe: 7, template_id: null, exercises: [] };
    expect(summarizeWorkout(w)).toBe("Logged workout — RPE 7, 0 exercises.");
  });
});

describe("summarizeCardio", () => {
  it("includes modality, duration, and kcal, and omits absent fields cleanly", () => {
    const full = summarizeCardio({ id: 1, modality: "bike", duration_min: 45, est_kcal: 420 });
    expect(full).toContain("bike");
    expect(full).toContain("45min");
    expect(full).toContain("420 kcal");
    const minimal = summarizeCardio({ id: 1, modality: null, duration_min: null, est_kcal: 200 });
    expect(minimal).toContain("200 kcal");
    expect(minimal).not.toContain("min");
  });
});

describe("summarizeSleep", () => {
  it("echoes night-of and wake date (Gaps 18, 30)", () => {
    const summary = summarizeSleep({ id: 1, hours: 7.6, quality: 4 }, "2026-05-13");
    expect(summary).toMatch(/night of/);
    expect(summary).toContain("2026-05-12"); // night-of = slept_on - 1
    expect(summary).toContain("2026-05-13"); // wake date
    expect(summary).toContain("7.6h");
    expect(summary).toContain("4/5");
  });

  it("omits quality slash when quality is null", () => {
    const summary = summarizeSleep({ id: 1, hours: 6, quality: null }, "2026-05-13");
    expect(summary).toContain("6h");
    expect(summary).not.toMatch(/\/5/);
  });
});

describe("summarizeAlcohol", () => {
  it("includes drinks_count and est_kcal", () => {
    const s = summarizeAlcohol({ id: 1, drinks_count: 5, est_kcal: 700 });
    expect(s).toContain("5 std");
    expect(s).toContain("700 kcal");
  });
});

describe("summarizeWeight", () => {
  it("includes weight_kg and measured_on", () => {
    const s = summarizeWeight({ id: 1, weight_kg: 82.3, measured_on: "2026-05-12" });
    expect(s).toContain("82.3 kg");
    expect(s).toContain("2026-05-12");
  });
});

describe("statusPhrase", () => {
  // Shared vocabulary across get_macros_today / get_macros_for_date /
  // get_day_status — pinning these strings here prevents accidental drift.
  it.each([
    ["on_track", "on track"],
    ["at_risk", "at risk (close to maintenance)"],
    ["off_track", "off track"],
  ] as const)("maps %s → %s", (status, phrase) => {
    expect(statusPhrase(status)).toBe(phrase);
  });
});

describe("summarizeAccomplishment — phase wins", () => {
  it("summarizes phase_complete with no prior_best", () => {
    const line = summarizeAccomplishment({
      message: "Cut complete: -4.2 kg over 10 weeks",
      earned_on: "2026-06-08",
      prior_best: null,
    });
    expect(line).toBe("🎉 Cut complete: -4.2 kg over 10 weeks.");
  });

  it("summarizes phase_halfway with no prior_best", () => {
    const line = summarizeAccomplishment({
      message: "Halfway through your cut — 10/20 days",
      earned_on: "2026-06-08",
      prior_best: null,
    });
    expect(line).toBe("🎉 Halfway through your cut — 10/20 days.");
  });

  it("labels a weight-bearing prior_best in kg by default (metric)", () => {
    const line = summarizeAccomplishment({
      code: "strength_pr",
      message: "New PR: Bench e1RM 96.5 kg",
      earned_on: "2026-06-08",
      prior_best: { earned_on: "2026-06-03", value: 93.5 },
    });
    expect(line).toBe("🎉 New PR: Bench e1RM 96.5 kg — your previous best was 90 kg (2026-06-03).");
  });

  it("converts a weight-bearing prior_best to lb for an imperial user", () => {
    const line = summarizeAccomplishment(
      {
        code: "strength_pr",
        message: "New PR: Bench e1RM 212.7 lb",
        earned_on: "2026-06-08",
        prior_best: { earned_on: "2026-06-03", value: 93.5 },
      },
      "imperial",
    );
    // strength_pr prior_best floors to nearest 5: 93.5 kg → 206.13 lb → floor5 = 205 lb
    expect(line).toBe(
      "🎉 New PR: Bench e1RM 212.7 lb — your previous best was 205 lb (2026-06-03).",
    );
  });

  it("leaves a non-weight prior_best (streak) unitless even for imperial", () => {
    const line = summarizeAccomplishment(
      {
        code: "weigh_in_streak",
        message: "14-day weigh-in streak",
        earned_on: "2026-06-08",
        prior_best: { earned_on: "2026-06-01", value: 10 },
      },
      "imperial",
    );
    expect(line).toBe("🎉 14-day weigh-in streak — your previous best was 10 (2026-06-01).");
  });
});

describe("summarizeAccomplishmentAggregates", () => {
  it("summarizes totals and per-type bests in one line", () => {
    const line = summarizeAccomplishmentAggregates({
      total: 37,
      by_type: {
        weigh_in_streak: 5,
        workout_consistency: 4,
        target_adherence_streak: 3,
        weight_milestone: 8,
        tdee_measured: 1,
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
        weigh_in_streak: { value: 30, earned_on: "2026-06-03" },
        workout_consistency: { value: 4, earned_on: "2026-06-01" },
        target_adherence_streak: { value: 14, earned_on: "2026-05-30" },
        weight_milestone: { value: 8, earned_on: "2026-06-06" },
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
    });
    expect(line).toContain("37 wins all-time");
    expect(line).toContain("longest weigh-in streak 30d");
    expect(line).toContain("most down 8kg");
  });

  it("renders 'most down' in lb for an imperial user", () => {
    const line = summarizeAccomplishmentAggregates(
      {
        total: 3,
        by_type: {
          weigh_in_streak: 0,
          workout_consistency: 0,
          target_adherence_streak: 0,
          weight_milestone: 1,
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
          weigh_in_streak: null,
          workout_consistency: null,
          target_adherence_streak: null,
          weight_milestone: { value: 8, earned_on: "2026-06-06" },
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
      "imperial",
    );
    // 8 kg * 2.20462262 = 17.63… → 17.6 lb
    expect(line).toContain("most down 17.6lb");
    expect(line).not.toContain("8kg");
  });

  it("handles empty history", () => {
    const line = summarizeAccomplishmentAggregates({
      total: 0,
      by_type: {
        weigh_in_streak: 0,
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
        weigh_in_streak: null,
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
    });
    expect(line).toContain("No wins yet");
  });
});
