import { describe, expect, it } from "vitest";
import { at, defined } from "../test-support/index.js";
import { DEFAULT_STIM_CONFIG, type StimConfig } from "./config.js";
import { computeStimStates } from "./stim.js";

const chest = { id: 1, name: "Chest" };
const back = { id: 2, name: "Back" };
const now = new Date("2026-05-12T18:00:00Z");

// Helper: build a workout fixture concisely.
function w(
  id: number,
  daysAgo: number,
  exerciseId: number,
  sets: Array<{ reps: number; weight_kg: number | null }>,
  rpe = 8,
) {
  const t = new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  return { id, started_at: t, rpe, exercises: [{ exercise_id: exerciseId, sets }] };
}

describe("computeStimStates", () => {
  it("returns detrained + level 0 when no workouts at all", () => {
    const r = computeStimStates({
      groups: [chest],
      workouts: [],
      exerciseToGroup: new Map(),
      latestBodyWeightKg: 80,
      now,
    });
    expect(r[0]?.phase).toBe("detrained");
    expect(r[0]?.last_hit_at).toBeNull();
    expect(r[0]?.level).toBe(0);
    expect(r[0]?.trainable_capacity).toBe("recovering");
  });

  it("throws if advice is missing the resolved phase", () => {
    const broken: StimConfig = {
      ...DEFAULT_STIM_CONFIG,
      advice: {} as StimConfig["advice"],
    };
    expect(() =>
      computeStimStates({
        groups: [chest],
        workouts: [],
        exerciseToGroup: new Map(),
        latestBodyWeightKg: 80,
        now,
        config: broken,
      }),
    ).toThrow(/advice/);
  });

  it("level is 0..100 and never null", () => {
    // Mixed inputs: baseline+recent, recent-only (week-one), empty, detrained.
    const inputs: Array<Parameters<typeof computeStimStates>[0]> = [
      // Empty
      {
        groups: [chest],
        workouts: [],
        exerciseToGroup: new Map(),
        latestBodyWeightKg: 80,
        now,
      },
      // Week-one (recent-only)
      {
        groups: [chest],
        workouts: [w(1, 2, 10, [{ reps: 10, weight_kg: 30 }])],
        exerciseToGroup: new Map([[10, chest.id]]),
        latestBodyWeightKg: 80,
        now,
      },
      // Baseline + recent
      {
        groups: [chest],
        workouts: [
          w(1, 3, 10, [{ reps: 10, weight_kg: 20 }]),
          w(2, 10, 10, [{ reps: 10, weight_kg: 20 }]),
          w(3, 14, 10, [{ reps: 10, weight_kg: 20 }]),
        ],
        exerciseToGroup: new Map([[10, chest.id]]),
        latestBodyWeightKg: 80,
        now,
      },
      // Heavy surge that would blow past 100 unbounded
      {
        groups: [chest],
        workouts: [
          // Recent: massive session
          w(1, 1, 10, [{ reps: 20, weight_kg: 200 }]),
          // Baseline: tiny sessions
          w(2, 10, 10, [{ reps: 5, weight_kg: 5 }]),
          w(3, 14, 10, [{ reps: 5, weight_kg: 5 }]),
        ],
        exerciseToGroup: new Map([[10, chest.id]]),
        latestBodyWeightKg: 80,
        now,
      },
    ];

    for (const input of inputs) {
      const states = computeStimStates(input);
      for (const s of states) {
        expect(typeof s.level).toBe("number");
        expect(s.level).toBeGreaterThanOrEqual(0);
        expect(s.level).toBeLessThanOrEqual(100);
      }
    }
  });

  it("level is 0 when there are no contributing sessions", () => {
    const states = computeStimStates({
      groups: [{ id: 1, name: "Chest" }],
      workouts: [],
      exerciseToGroup: new Map(),
      latestBodyWeightKg: 80,
      now: new Date("2026-05-13T12:00:00Z"),
    });
    expect(at(states, 0).level).toBe(0);
  });

  it("level reflects recent volume when baseline data is thin (week-one user)", () => {
    // One strong recent workout, nothing in baseline window. Should report a
    // positive level from the decay-based fallback, not null.
    const r = computeStimStates({
      groups: [chest],
      // 10 sets × 10 reps × 80kg = 8000 volume × RPE 0.9 = 7200 quality_volume.
      // With decayCredit very close to 1.0 (1 day ago), credit ≈ 7200.
      // Default earlyDaysCeiling = 3000 → ratio > 1.0 → clamped to 100.
      workouts: [
        w(
          1,
          1,
          10,
          Array.from({ length: 10 }, () => ({ reps: 10, weight_kg: 80 })),
          9,
        ),
      ],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    expect(r[0]?.level).not.toBeNull();
    expect(at(r, 0).level).toBeGreaterThan(80);
    expect(at(r, 0).level).toBeLessThanOrEqual(100);
  });

  it("level matches the comparative ratio when baseline data is present", () => {
    // Recent: 1 session at day 3, vol = 10*20=200, RPE 8 → quality 160.
    //   decay(72h)=1 (within fullCreditUntilHours=168h) → credit 160.
    // Baseline (21d-7d band): sessions at day 10 (240h) and day 14 (336h).
    //   decay(240h) = 0.85 (halfwayFadeAtHours boundary)
    //   decay(336h) is in [halfwayFadeAtHours=240, fastFadeAtHours=504]:
    //     t = (336-240)/(504-240) = 96/264; decay = 0.85 - t*(0.85-0.5) ≈ 0.7227
    //   baselineCredit = 160*0.85 + 160*0.7227 ≈ 251.64
    // level = min(100, 160/251.64 * 100) ≈ 63.58
    const decayDay14 = 0.85 - (96 / 264) * (0.85 - 0.5);
    const expectedLevel = (160 / (160 * 0.85 + 160 * decayDay14)) * 100;
    const r = computeStimStates({
      groups: [chest],
      workouts: [
        w(1, 3, 10, [{ reps: 10, weight_kg: 20 }]),
        w(2, 10, 10, [{ reps: 10, weight_kg: 20 }]),
        w(3, 14, 10, [{ reps: 10, weight_kg: 20 }]),
      ],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    expect(r[0]?.level).toBeCloseTo(expectedLevel, 1);
  });

  it("level is capped at 100 even when recent volume vastly exceeds baseline", () => {
    const r = computeStimStates({
      groups: [chest],
      workouts: [
        // Massive recent surge
        w(1, 1, 10, [{ reps: 20, weight_kg: 200 }]),
        // Tiny baseline
        w(2, 10, 10, [{ reps: 5, weight_kg: 5 }]),
        w(3, 14, 10, [{ reps: 5, weight_kg: 5 }]),
      ],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    expect(r[0]?.level).toBe(100);
  });

  it("returns prime phase ~4 days after last session", () => {
    const r = computeStimStates({
      groups: [chest],
      workouts: [
        w(1, 4, 10, [
          { reps: 12, weight_kg: 22 },
          { reps: 12, weight_kg: 22 },
          { reps: 12, weight_kg: 22 },
        ]),
      ],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    expect(r[0]?.phase).toBe("prime");
    expect(r[0]?.trainable_capacity).toBe("fresh");
    expect(r[0]?.hours_since_last_hit).toBeCloseTo(96, 0);
  });

  it("returns fading phase + light_reminder advice ~9 days post-session", () => {
    const r = computeStimStates({
      groups: [chest],
      workouts: [w(1, 9, 10, [{ reps: 12, weight_kg: 22 }])],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    expect(r[0]?.phase).toBe("fading");
    expect(r[0]?.advice.recommendation).toBe("light_reminder");
    expect(r[0]?.advice.suggested_intensity_pct).toBeLessThan(95);
  });

  it("contributing_sessions exposes started_at so callers can reason about decay timing (Gap 22)", () => {
    const r = computeStimStates({
      groups: [chest],
      workouts: [w(1, 3, 10, [{ reps: 10, weight_kg: 80 }])],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: null,
      now,
    });
    const entry = r[0]?.contributing_sessions[0];
    expect(entry?.started_at).toBeDefined();
    // Just verify the shape — value depends on the test fixture's `w()` helper.
    expect(typeof entry?.started_at).toBe("string");
    expect(entry?.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("BODYWEIGHT: null-weight sets contribute via bodyweight × multiplier", () => {
    // 1 set of 20 push-ups, latest bodyweight 80kg → volume = 20 × 80 × 1.0 = 1600
    const r = computeStimStates({
      groups: [chest],
      workouts: [w(1, 3, 10, [{ reps: 20, weight_kg: null }])],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    expect(r[0]?.phase).toBe("prime");
    expect(r[0]?.last_hit_at).not.toBeNull();
    expect(r[0]?.contributing_sessions.length).toBe(1);
    // quality_volume = volume × intensity = 1600 × 0.8 = 1280
    expect(r[0]?.contributing_sessions[0]?.quality_volume).toBeCloseTo(1280, 0);
  });

  it("BODYWEIGHT: no body-weight reading → uses config.bodyweight.fallbackKg (75)", () => {
    const r = computeStimStates({
      groups: [chest],
      workouts: [w(1, 3, 10, [{ reps: 20, weight_kg: null }])],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: null,
      now,
    });
    expect(r[0]?.contributing_sessions.length).toBe(1);
    // 20 × 75 × 1.0 × 0.8 = 1200
    expect(r[0]?.contributing_sessions[0]?.quality_volume).toBeCloseTo(1200, 0);
  });

  it("EXERCISE FILTERING: sets for other groups don't leak into this group's credit", () => {
    // chest_ex=10, back_ex=20. Workout has both. Only chest credits chest.
    const wMixed = {
      id: 1,
      started_at: new Date(now.getTime() - 4 * 86_400_000).toISOString(),
      rpe: 8,
      exercises: [
        { exercise_id: 10, sets: [{ reps: 12, weight_kg: 20 }] },
        { exercise_id: 20, sets: [{ reps: 12, weight_kg: 50 }] },
      ],
    };
    const r = computeStimStates({
      groups: [chest, back],
      workouts: [wMixed],
      exerciseToGroup: new Map([
        [10, chest.id],
        [20, back.id],
      ]),
      latestBodyWeightKg: 80,
      now,
    });
    const chestState = defined(
      r.find((s) => s.group_id === chest.id),
      "chest state",
    );
    const backState = defined(
      r.find((s) => s.group_id === back.id),
      "back state",
    );
    // chest: 12 × 20 × 0.8 = 192
    expect(chestState.contributing_sessions[0]?.quality_volume).toBeCloseTo(192, 0);
    // back:  12 × 50 × 0.8 = 480
    expect(backState.contributing_sessions[0]?.quality_volume).toBeCloseTo(480, 0);
  });

  it("MULTI-WORKOUT: multiple recent sessions all contribute and decay independently", () => {
    const r = computeStimStates({
      groups: [chest],
      workouts: [
        w(1, 1, 10, [{ reps: 12, weight_kg: 20 }]), // very fresh
        w(2, 4, 10, [{ reps: 12, weight_kg: 20 }]), // prime
        w(3, 6, 10, [{ reps: 12, weight_kg: 20 }]), // still in window
      ],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    expect(r[0]?.contributing_sessions.length).toBe(3);
    expect(r[0]?.phase).toBe("too_soon"); // most recent was 1 day ago
    // last_hit_at should match workout 1 (most recent)
    expect(r[0]?.last_hit_at).toBeTruthy();
  });

  it("BASELINE WINDOW: level is computed against the [21d, 7d) prior band", () => {
    // Recent: 1 session at day 3 with volume 200 (RPE 8 → quality 160)
    // Baseline window (21d–7d ago): 2 sessions at day 10 and day 14 with same volume
    // → baseline quality_volume ≈ 2 × 160 × decay(10d/14d)
    //   decay(10d=240h) = 0.85, decay(14d=336h) ≈ 0.5
    //   baseline ≈ 160 × 0.85 + 160 × 0.5 = 216
    // Recent credit ≈ 160 × decay(3d=72h) = 160 × 1 = 160
    // level ≈ 160 / 216 × 100 ≈ 74
    const r = computeStimStates({
      groups: [chest],
      workouts: [
        w(1, 3, 10, [{ reps: 10, weight_kg: 20 }]), // recent
        w(2, 10, 10, [{ reps: 10, weight_kg: 20 }]),
        w(3, 14, 10, [{ reps: 10, weight_kg: 20 }]),
      ],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    expect(r[0]?.level).not.toBeNull();
    expect(at(r, 0).level).toBeGreaterThan(40);
    expect(at(r, 0).level).toBeLessThan(120);
    // contributing_sessions includes recent-window sessions only — the two
    // baseline-band sessions at 10d and 14d feed the denominator, not this list.
    expect(r[0]?.contributing_sessions.length).toBe(1);
    expect(r[0]?.contributing_sessions[0]?.workout_id).toBe(1); // the day-3 session
  });

  it("BASELINE WINDOW: level falls back to decay-based score when baseline has fewer than 2 sessions", () => {
    // Only one recent session, nothing in the 21d–7d baseline band. Previously
    // returned null; now returns a decay-weighted recent score so week-one
    // users still see signal.
    const r = computeStimStates({
      groups: [chest],
      workouts: [w(1, 3, 10, [{ reps: 10, weight_kg: 20 }])],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    expect(r[0]?.level).not.toBeNull();
    expect(typeof r[0]?.level).toBe("number");
    expect(at(r, 0).level).toBeGreaterThan(0);
    expect(at(r, 0).level).toBeLessThanOrEqual(100);
    expect(r[0]?.phase).toBe("prime"); // phase still computed
  });

  it("V1 INVARIANT: context_multiplier is always 1.0", () => {
    const r = computeStimStates({
      groups: [chest],
      workouts: [w(1, 4, 10, [{ reps: 12, weight_kg: 22 }])],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    for (const s of r[0]?.contributing_sessions ?? []) {
      expect(s.context_multiplier).toBe(1.0);
    }
  });

  it.skip("V1.5: context_multiplier rewards return-to-load behavior", () => {
    // TODO(v1.5): when per-exercise baseline working weights are computed,
    // a session that hits ~the recommended intensity during fading/detrained
    // should earn context_multiplier > 1. Replace the v1 invariant test with
    // this when the feature lands.
  });

  it("trainable_capacity is one of 'depleted' | 'recovering' | 'fresh'", () => {
    const states = computeStimStates({
      groups: [{ id: 1, name: "Chest" }],
      workouts: [],
      exerciseToGroup: new Map(),
      latestBodyWeightKg: 80,
      now: new Date("2026-05-13T12:00:00Z"),
    });
    for (const s of states) {
      expect(["depleted", "recovering", "fresh"]).toContain(s.trainable_capacity);
    }
  });

  it("maps low capacity (≤25) to 'depleted', mid (26-75) to 'recovering', high (>75) to 'fresh'", () => {
    // Pin each bucket by varying time-since-last-session against DEFAULT_STIM_CONFIG.capacityCurve:
    //   <24h  → pct=20  → 'depleted'
    //   <48h  → pct=50  → 'recovering'
    //   <120h → pct=100 → 'fresh'

    // Depleted: hit ~12 hours ago.
    const depleted = computeStimStates({
      groups: [chest],
      workouts: [
        {
          id: 1,
          started_at: new Date(now.getTime() - 12 * 3_600_000).toISOString(),
          rpe: 8,
          exercises: [{ exercise_id: 10, sets: [{ reps: 12, weight_kg: 22 }] }],
        },
      ],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    expect(depleted[0]?.trainable_capacity).toBe("depleted");

    // Recovering: hit ~36 hours ago (lands in the 24-48h band → pct=50).
    const recovering = computeStimStates({
      groups: [chest],
      workouts: [
        {
          id: 1,
          started_at: new Date(now.getTime() - 36 * 3_600_000).toISOString(),
          rpe: 8,
          exercises: [{ exercise_id: 10, sets: [{ reps: 12, weight_kg: 22 }] }],
        },
      ],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    expect(recovering[0]?.trainable_capacity).toBe("recovering");

    // Fresh: hit ~96 hours (4d) ago — prime window, pct=100.
    const fresh = computeStimStates({
      groups: [chest],
      workouts: [w(1, 4, 10, [{ reps: 12, weight_kg: 22 }])],
      exerciseToGroup: new Map([[10, chest.id]]),
      latestBodyWeightKg: 80,
      now,
    });
    expect(fresh[0]?.trainable_capacity).toBe("fresh");
  });
});
