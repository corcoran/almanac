import { describe, expect, it } from "vitest";
import { recommendTemplate } from "./recommend-template.js";
import type { StimState } from "./stim.js";

function mkStim(
  id: number,
  name: string,
  phase: StimState["phase"],
  hoursSinceLastHit: number | null = null,
): StimState {
  return {
    group_id: id,
    group_name: name,
    level: 50,
    trainable_capacity: "fresh",
    phase,
    last_hit_at:
      hoursSinceLastHit === null
        ? null
        : new Date(Date.now() - hoursSinceLastHit * 3_600_000).toISOString(),
    hours_since_last_hit: hoursSinceLastHit,
    advice: { recommendation: "", rationale: "", suggested_intensity_pct: 100 },
    contributing_sessions: [],
  };
}

describe("recommendTemplate", () => {
  it("ranks the more-recovered template first; score breaks recovery ties", () => {
    // PULL hits Back+Biceps (both prime, avg 100h). PUSH hits Chest+Triceps
    // (too_soon, avg 30h). Recency-first: PULL (100h) ranks above PUSH (30h).
    // (Under the old score-first model PULL also won, but via score; here the
    // reason is recovery.)
    const stim = [
      mkStim(1, "Chest", "too_soon", 30),
      mkStim(2, "Back", "prime", 100),
      mkStim(3, "Biceps", "prime", 100),
      mkStim(4, "Triceps", "too_soon", 30),
    ];
    const templates = [
      { id: 10, name: "PUSH", items: [{ exercise_id: 100 }, { exercise_id: 400 }] },
      { id: 20, name: "PULL", items: [{ exercise_id: 200 }, { exercise_id: 300 }] },
    ];
    const exerciseToGroup = new Map<number, number>([
      [100, 1], // PUSH → Chest (too_soon)
      [400, 4], // PUSH → Triceps (too_soon)
      [200, 2], // PULL → Back (prime)
      [300, 3], // PULL → Biceps (prime)
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    expect(recs[0]?.template_name).toBe("PULL");
    expect(recs[0]?.avg_recovery_hours).toBe(100);
    expect(recs[0]?.score).toBe(2);
    expect(recs[0]?.reasoning.prime_groups_hit.sort()).toEqual(["Back", "Biceps"]);
    expect(recs[1]?.template_name).toBe("PUSH");
    expect(recs[1]?.avg_recovery_hours).toBe(30);
  });

  it("applies a flat -2 penalty when any too_soon group is hit (not per-group)", () => {
    // Flat-penalty rationale: see recommend-template.ts JSDoc. The penalty
    // signals "you're trying to train something you just hit" — a binary
    // conflict flag, not a count. Multi-group templates aren't punished extra
    // for having more muscles in the too_soon bucket; the avg_recovery_hours
    // tie-break does that work.
    const stim = [
      mkStim(1, "Chest", "prime"),
      mkStim(2, "Back", "too_soon"),
      mkStim(3, "Biceps", "too_soon"),
    ];
    const templates = [
      // PUSH: 1 prime, 0 too_soon → 1
      { id: 10, name: "PUSH", items: [{ exercise_id: 100 }] },
      // MIXED1: 1 prime, 1 too_soon → 1 - 2 = -1
      { id: 20, name: "MIXED1", items: [{ exercise_id: 100 }, { exercise_id: 200 }] },
      // MIXED2: 1 prime, 2 too_soon → 1 - 2 = -1 (same as MIXED1; flat penalty)
      {
        id: 30,
        name: "MIXED2",
        items: [{ exercise_id: 100 }, { exercise_id: 200 }, { exercise_id: 300 }],
      },
    ];
    const exerciseToGroup = new Map<number, number>([
      [100, 1],
      [200, 2],
      [300, 3],
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    expect(recs[0]?.template_name).toBe("PUSH");
    expect(recs[0]?.score).toBe(1);
    // MIXED1 and MIXED2 both score -1 (flat penalty). Order between them is
    // by avg_recovery_hours then name; all stims here are null-hours so the
    // recency tie-break is a wash and name decides: MIXED1 before MIXED2.
    expect(recs[1]?.score).toBe(-1);
    expect(recs[2]?.score).toBe(-1);
    expect(recs[1]?.template_name).toBe("MIXED1");
    expect(recs[2]?.template_name).toBe("MIXED2");
  });

  it("returns [] when no templates exist", () => {
    expect(
      recommendTemplate({ templates: [], stimStates: [], exerciseToGroup: new Map() }),
    ).toEqual([]);
  });

  it("returns the template even when all groups are too_soon (the caller decides)", () => {
    const stim = [mkStim(1, "Chest", "too_soon")];
    const templates = [{ id: 10, name: "PUSH", items: [{ exercise_id: 100 }] }];
    const exerciseToGroup = new Map<number, number>([[100, 1]]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    expect(recs).toHaveLength(1);
    expect(recs[0]?.score).toBe(-2);
    expect(recs[0]?.reasoning.too_soon_groups_hit).toEqual(["Chest"]);
  });

  it("breaks equal-recovery ties by score, then alphabetically", () => {
    // All three templates hit groups at the same recency (100h), so the primary
    // key ties and `score` decides: MIXED (2 prime) > PULL/PUSH (1 prime each),
    // and PULL/PUSH tie on score → alphabetical.
    const stim = [mkStim(1, "Chest", "prime", 100), mkStim(2, "Back", "prime", 100)];
    const templates = [
      { id: 10, name: "PUSH", items: [{ exercise_id: 100 }] },
      { id: 20, name: "PULL", items: [{ exercise_id: 200 }] },
      { id: 30, name: "MIXED", items: [{ exercise_id: 100 }, { exercise_id: 200 }] },
    ];
    const exerciseToGroup = new Map<number, number>([
      [100, 1],
      [200, 2],
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    expect(recs).toHaveLength(3);
    expect(recs[0]?.template_name).toBe("MIXED"); // 2 prime → score 2
    expect(recs[0]?.score).toBe(2);
    // PULL and PUSH both score 1 at equal recovery; PULL sorts first alphabetically.
    expect(recs[1]?.score).toBe(1);
    expect(recs[2]?.score).toBe(1);
    expect(recs[1]?.template_name).toBe("PULL");
    expect(recs[2]?.template_name).toBe("PUSH");
  });

  it("classifies acceptable as neutral, fading/detrained as overdue (in_window bucketed separately)", () => {
    const stim = [
      mkStim(1, "Chest", "prime"),
      mkStim(2, "Back", "acceptable"),
      mkStim(3, "Quads", "fading"),
      mkStim(4, "Calves", "detrained"),
    ];
    const templates = [
      {
        id: 10,
        name: "PUSH",
        items: [
          { exercise_id: 100 },
          { exercise_id: 200 },
          { exercise_id: 300 },
          { exercise_id: 400 },
        ],
      },
    ];
    const exerciseToGroup = new Map<number, number>([
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    expect(recs[0]?.reasoning.prime_groups_hit).toEqual(["Chest"]);
    expect(recs[0]?.reasoning.in_window_groups_hit).toEqual([]);
    expect(recs[0]?.reasoning.too_soon_groups_hit).toEqual([]);
    // acceptable → neutral; fading + detrained → overdue.
    expect(recs[0]?.reasoning.neutral_groups_hit).toEqual(["Back"]);
    expect(recs[0]?.reasoning.overdue_groups_hit).toEqual(["Calves", "Quads"]);
  });

  it("ranks a more-overdue in_window template above a fresher prime one (recency-first)", () => {
    // PUSH hits Chest (in_window, 144h). LEGS hits Quads (prime, 96h). Under the
    // old model PUSH won on the in_window urgency weighting; under recency-first
    // PUSH wins simply because 144h > 96h. Order is the same, the reason is not.
    const stim = [mkStim(1, "Chest", "in_window", 144), mkStim(2, "Quads", "prime", 96)];
    const templates = [
      { id: 10, name: "PUSH", items: [{ exercise_id: 100 }] },
      { id: 20, name: "LEGS", items: [{ exercise_id: 200 }] },
    ];
    const exerciseToGroup = new Map<number, number>([
      [100, 1],
      [200, 2],
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    expect(recs[0]?.template_name).toBe("PUSH");
    expect(recs[0]?.avg_recovery_hours).toBe(144);
    expect(recs[0]?.reasoning.in_window_groups_hit).toEqual(["Chest"]);
    expect(recs[0]?.reasoning.prime_groups_hit).toEqual([]);
    expect(recs[1]?.template_name).toBe("LEGS");
    expect(recs[1]?.avg_recovery_hours).toBe(96);
    expect(recs[1]?.reasoning.prime_groups_hit).toEqual(["Quads"]);
    expect(recs[1]?.reasoning.in_window_groups_hit).toEqual([]);
  });

  it("still computes score (in_window +2 each, flat too_soon -2); recency orders the result", () => {
    // MIXED: two in_window (+4) + one too_soon (-2) → score 2, avg recency low
    // because the too_soon group (10h) drags the mean down.
    // PRIME_ONLY: two prime → score 2, avg 110h. Equal score, but PRIME_ONLY is
    // more recovered → ranks first under recency-first.
    const stim = [
      mkStim(1, "Chest", "in_window", 150),
      mkStim(2, "Back", "in_window", 150),
      mkStim(3, "Biceps", "too_soon", 10),
      mkStim(4, "Quads", "prime", 110),
      mkStim(5, "Hamstrings", "prime", 110),
    ];
    const templates = [
      {
        id: 10,
        name: "MIXED",
        items: [{ exercise_id: 100 }, { exercise_id: 200 }, { exercise_id: 300 }],
      },
      { id: 20, name: "PRIME_ONLY", items: [{ exercise_id: 400 }, { exercise_id: 500 }] },
    ];
    const exerciseToGroup = new Map<number, number>([
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
      [500, 5],
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    // Both score 2 (in_window stacks above prime; too_soon is a flat -2).
    const mixed = recs.find((r) => r.template_name === "MIXED");
    const primeOnly = recs.find((r) => r.template_name === "PRIME_ONLY");
    expect(mixed?.score).toBe(2);
    expect(primeOnly?.score).toBe(2);
    expect(mixed?.reasoning.in_window_groups_hit).toEqual(["Back", "Chest"]);
    expect(mixed?.reasoning.too_soon_groups_hit).toEqual(["Biceps"]);
    // PRIME_ONLY (avg 110h) is more recovered than MIXED (avg (150+150+10)/3 ≈ 103h)
    // → recency-first ranks PRIME_ONLY first despite the score tie.
    expect(recs[0]?.template_name).toBe("PRIME_ONLY");
    expect(recs[1]?.template_name).toBe("MIXED");
  });

  it("breaks ties by recency when all templates have only too_soon groups", () => {
    // Reproduces the user's actual scenario:
    //   LEGS hit 0.4h ago, PUSH hit 1.5h ago, PULL hit 22h ago.
    // All groups are `too_soon`. The previous per-group penalty (−2 each)
    // made score degrade to "fewest groups wins" (LEGS −6, PUSH −8, PULL −12),
    // surfacing LEGS even though it was the most-recently-trained. With the
    // flat penalty all three score −2 and `avg_recovery_hours` picks the
    // template that has waited longest — PULL at 22h.
    const stim = [
      // LEGS (3 groups, 0.4h)
      mkStim(1, "Quadriceps", "too_soon", 0.4),
      mkStim(2, "Hamstrings", "too_soon", 0.4),
      mkStim(3, "Calves", "too_soon", 0.4),
      // PUSH (4 groups, 1.5h)
      mkStim(4, "Chest", "too_soon", 1.5),
      mkStim(5, "Deltoid (front)", "too_soon", 1.5),
      mkStim(6, "Triceps", "too_soon", 1.5),
      mkStim(7, "Abdominals", "too_soon", 1.5),
      // PULL (6 groups, 22h)
      mkStim(8, "Back", "too_soon", 22),
      mkStim(9, "Biceps", "too_soon", 22),
      mkStim(10, "Deltoid (side/rear)", "too_soon", 22),
      mkStim(11, "Forearms", "too_soon", 22),
      mkStim(12, "Obliques", "too_soon", 22),
      mkStim(13, "Traps", "too_soon", 22),
    ];
    const templates = [
      {
        id: 1,
        name: "LEGS",
        items: [{ exercise_id: 1 }, { exercise_id: 2 }, { exercise_id: 3 }],
      },
      {
        id: 2,
        name: "PUSH",
        items: [{ exercise_id: 4 }, { exercise_id: 5 }, { exercise_id: 6 }, { exercise_id: 7 }],
      },
      {
        id: 3,
        name: "PULL",
        items: [
          { exercise_id: 8 },
          { exercise_id: 9 },
          { exercise_id: 10 },
          { exercise_id: 11 },
          { exercise_id: 12 },
          { exercise_id: 13 },
        ],
      },
    ];
    const exerciseToGroup = new Map<number, number>([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
      [7, 7],
      [8, 8],
      [9, 9],
      [10, 10],
      [11, 11],
      [12, 12],
      [13, 13],
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    expect(recs[0]?.template_name).toBe("PULL");
    // All three templates tie at the flat -2 penalty; PULL wins on recency.
    expect(recs[0]?.score).toBe(-2);
    expect(recs[0]?.avg_recovery_hours).toBe(22);
    // Order after PULL: PUSH (1.5h) then LEGS (0.4h) by avg_recovery_hours desc.
    expect(recs[1]?.template_name).toBe("PUSH");
    expect(recs[1]?.avg_recovery_hours).toBe(1.5);
    expect(recs[2]?.template_name).toBe("LEGS");
    expect(recs[2]?.avg_recovery_hours).toBeCloseTo(0.4, 5);
  });

  it("computes avg_recovery_hours as the mean of hit groups", () => {
    const stim = [mkStim(1, "Chest", "in_window", 10), mkStim(2, "Back", "in_window", 30)];
    const templates = [
      {
        id: 10,
        name: "UPPER",
        items: [{ exercise_id: 100 }, { exercise_id: 200 }],
      },
    ];
    const exerciseToGroup = new Map<number, number>([
      [100, 1],
      [200, 2],
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    expect(recs[0]?.avg_recovery_hours).toBe(20);
  });

  it("treats never-trained groups as fully recovered (999_999h sentinel)", () => {
    // Single group, never trained (last_hit_at: null, hours_since_last_hit: null).
    // avg_recovery_hours should surface the sentinel so an all-untrained
    // template beats any trained template in a tie.
    const stim = [mkStim(1, "Chest", "detrained", null)];
    const templates = [{ id: 10, name: "PUSH", items: [{ exercise_id: 100 }] }];
    const exerciseToGroup = new Map<number, number>([[100, 1]]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    expect(recs[0]?.avg_recovery_hours).toBe(999_999);
  });

  it("flags confidence: low for the returning-from-layoff degenerate case", () => {
    // Every group is fading/detrained (the post-vacation case). All templates
    // score 0, so the ranking is meaningless — confidence must be "low" so a
    // consumer doesn't surface "do LEGS (score 0)" as if it were real advice.
    const stim = [
      mkStim(1, "Quadriceps", "fading", 250),
      mkStim(2, "Hamstrings", "fading", 250),
      mkStim(3, "Chest", "fading", 210),
      mkStim(4, "Back", "detrained", 400),
    ];
    const templates = [
      { id: 1, name: "LEGS", items: [{ exercise_id: 1 }, { exercise_id: 2 }] },
      { id: 2, name: "PUSH", items: [{ exercise_id: 3 }] },
      { id: 3, name: "PULL", items: [{ exercise_id: 4 }] },
    ];
    const exerciseToGroup = new Map<number, number>([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    // Every template scores 0 and is flagged low-confidence.
    for (const r of recs) {
      expect(r.score).toBe(0);
      expect(r.confidence).toBe("low");
    }
    // The overdue groups are surfaced so the layoff is visible, not hidden in
    // a generic "neutral" bucket.
    const legs = recs.find((r) => r.template_name === "LEGS");
    expect(legs?.reasoning.overdue_groups_hit.sort()).toEqual(["Hamstrings", "Quadriceps"]);
    // Even when every template is confidence:"low", recency-first still gives a
    // defined order — most-overdue first — rather than a meaningless score tie.
    // PULL (Back 400h) > LEGS (250h) > PUSH (210h).
    expect(recs.map((r) => r.template_name)).toEqual(["PULL", "LEGS", "PUSH"]);
  });

  it("marks confidence: actionable when a real prime/in_window signal exists", () => {
    const stim = [mkStim(1, "Chest", "prime"), mkStim(2, "Quads", "fading", 250)];
    const templates = [
      { id: 10, name: "PUSH", items: [{ exercise_id: 100 }] },
      { id: 20, name: "LEGS", items: [{ exercise_id: 200 }] },
    ];
    const exerciseToGroup = new Map<number, number>([
      [100, 1],
      [200, 2],
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    const push = recs.find((r) => r.template_name === "PUSH");
    const legs = recs.find((r) => r.template_name === "LEGS");
    // PUSH hits a prime group → real signal → actionable.
    expect(push?.score).toBe(1);
    expect(push?.confidence).toBe("actionable");
    // LEGS hits only a fading group → score 0, no real signal → low.
    expect(legs?.score).toBe(0);
    expect(legs?.confidence).toBe("low");
    expect(legs?.reasoning.overdue_groups_hit).toEqual(["Quads"]);
  });

  it("separates fading/detrained (overdue) from acceptable (neutral)", () => {
    const stim = [
      mkStim(1, "Chest", "acceptable"),
      mkStim(2, "Quads", "fading"),
      mkStim(3, "Calves", "detrained"),
    ];
    const templates = [
      {
        id: 10,
        name: "FULL",
        items: [{ exercise_id: 100 }, { exercise_id: 200 }, { exercise_id: 300 }],
      },
    ];
    const exerciseToGroup = new Map<number, number>([
      [100, 1],
      [200, 2],
      [300, 3],
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    expect(recs[0]?.reasoning.neutral_groups_hit).toEqual(["Chest"]);
    expect(recs[0]?.reasoning.overdue_groups_hit).toEqual(["Calves", "Quads"]);
  });

  it("ranks the most-overdue template first, above a prime template (the cut-retention fix)", () => {
    // The reported bug: PUSH last trained 12 days ago (~288h, fading) was ranked
    // BELOW a LEGS template hitting a group merely approaching prime, because
    // overdue groups contribute 0 to `score` and got flagged confidence:"low".
    // Recency-first ranking: PUSH (avg 288h) must rank FIRST over LEGS (avg 96h),
    // because the most-neglected group is the top retention priority on a cut.
    const stim = [mkStim(1, "Chest", "fading", 288), mkStim(2, "Quads", "prime", 96)];
    const templates = [
      { id: 10, name: "PUSH", items: [{ exercise_id: 100 }] },
      { id: 20, name: "LEGS", items: [{ exercise_id: 200 }] },
    ];
    const exerciseToGroup = new Map<number, number>([
      [100, 1],
      [200, 2],
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    expect(recs[0]?.template_name).toBe("PUSH");
    expect(recs[0]?.avg_recovery_hours).toBe(288);
    expect(recs[0]?.reasoning.overdue_groups_hit).toEqual(["Chest"]);
    expect(recs[1]?.template_name).toBe("LEGS");
    expect(recs[1]?.avg_recovery_hours).toBe(96);
  });

  it("ranks an overdue template above a multi-prime template (overdue outranks score)", () => {
    // STACKED hits two in_window + one prime (score 2*2+1 = 5) but all recent
    // (avg 130h). NEGLECTED hits one fading group (score 0) at 300h. Recency-
    // first: NEGLECTED ranks first despite far lower score — overdue is the
    // top priority, and score is only a tie-break among equally-recovered picks.
    const stim = [
      mkStim(1, "Chest", "in_window", 130),
      mkStim(2, "Back", "in_window", 130),
      mkStim(3, "Biceps", "prime", 100),
      mkStim(4, "Quads", "fading", 300),
    ];
    const templates = [
      {
        id: 10,
        name: "STACKED",
        items: [{ exercise_id: 100 }, { exercise_id: 200 }, { exercise_id: 300 }],
      },
      { id: 20, name: "NEGLECTED", items: [{ exercise_id: 400 }] },
    ];
    const exerciseToGroup = new Map<number, number>([
      [100, 1],
      [200, 2],
      [300, 3],
      [400, 4],
    ]);
    const recs = recommendTemplate({ templates, stimStates: stim, exerciseToGroup });
    expect(recs[0]?.template_name).toBe("NEGLECTED");
    expect(recs[0]?.avg_recovery_hours).toBe(300);
    expect(recs[1]?.template_name).toBe("STACKED");
    // STACKED still has the higher score (5); it's just outranked on recency.
    expect(recs[0]?.score).toBe(0);
    expect(recs[1]?.score).toBe(5);
  });
});
