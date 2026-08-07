import { describe, expect, it } from "vitest";
import { type ShareReport, ShareReportSchema } from "../schemas/report.js";
import { buildReportMarkdown } from "./report-markdown.js";

/**
 * Full, schema-valid ShareReport fixture: metric user, active cut phase,
 * measured TDEE, 4 history days (3 tracked + 1 untracked), workouts across 3
 * templates. Numbers are kept round so substring assertions read clearly.
 */
function makeReport(overrides: Partial<ShareReport> = {}): ShareReport {
  const base: ShareReport = {
    generated_for_date: "2026-06-20",
    context: {
      now: "2026-06-20T14:00:00.000Z",
      today_date: "2026-06-20",
      user: {
        id: 1,
        name: "Jeff",
        timezone: "America/Toronto",
        preferred_unit_system: "metric",
        activity_level: "moderate",
      },
      phase: {
        id: 9,
        user_id: 1,
        name: "Spring Cut",
        intent: "cut",
        phase_type: "cut",
        tdee_at_phase_start: 2550,
        tdee_source: "measured",
        deficit_kcal: 500,
        daily_kcal_target: 2050,
        base_protein_g: 180,
        base_carb_g: 200,
        base_fat_g: 60,
        started_on: "2026-05-11",
        planned_end_on: "2026-06-30",
        ended_on: null,
        notes: null,
        created_at: "2026-05-11T12:00:00.000Z",
        days_in: 40,
        days_remaining: 10,
      },
      today: {
        kcal_in: 1420,
        protein_g_in: 142,
        carb_g_in: 130,
        fat_g_in: 38,
        meals_logged_today: true,
        target: { kcal: 2050, protein_g: 180, carb_g: 200, fat_g: 60 },
        maintenance: { kcal: 2540 },
        intake: { kcal: 1420, protein_g: 142, carb_g: 130, fat_g: 38 },
        observed: {
          cardio_kcal: 0,
          workout_kcal: 0,
          steps_kcal: 0,
          vs_target: -480,
          vs_maintenance: -1120,
          status: "on_track",
        },
        body_weight_kg: 82.4,
        most_recent_weight: { value_kg: 82.4, on_date: "2026-06-20" },
        sleep: { hours: 7.1, quality: 4 },
        steps: { id: 5, count: 8000, est_kcal: 320 },
        workouts: [{ id: 1, template_name: "Push", rpe: 8 }],
        cardio: [],
        alcohol: [],
        energy_balance: {
          food_in: 1420,
          alcohol_in: 0,
          total_in: 1420,
          tdee_baseline: 2540,
          cardio_out: 0,
          workout_out: 0,
          steps_out: 0,
          net: -1120,
        },
      },
      week_to_date: {
        workouts_count: { value: 4, window_days: 7, days_with_data: 7 },
        cardio_sessions_count: { value: 3, window_days: 7, days_with_data: 7 },
        cardio_minutes: { value: 95, window_days: 7, days_with_data: 7 },
        cardio_kcal: { value: 720, window_days: 7, days_with_data: 7 },
        alcohol_drinks_count: { value: 2, window_days: 7, days_with_data: 7 },
        alcohol_kcal: { value: 300, window_days: 7, days_with_data: 7 },
        drinking_days_count: { value: 1, window_days: 7, days_with_data: 7 },
        avg_kcal_in: { value: 1980, window_days: 7, days_with_data: 7 },
        avg_protein_g: { value: 168, window_days: 7, days_with_data: 7 },
        sleep_avg_hours: { value: 7.1, window_days: 7, days_with_data: 7 },
        sleep_debt: {
          debt_hours: 4.2,
          window_days: 7,
          baseline_hours: 8,
          avg_hours: 7.1,
          nights_logged: 7,
        },
      },
      stim_states: [
        {
          group_id: 1,
          group_name: "Chest",
          level: 0.2,
          trainable_capacity: "fresh",
          phase: "prime",
          last_hit_at: "2026-06-17T18:00:00.000Z",
          hours_since_last_hit: 68,
          advice: { recommendation: "go", rationale: "rested", suggested_intensity_pct: 100 },
          contributing_sessions: [],
        },
        {
          group_id: 2,
          group_name: "Back",
          level: 0.5,
          trainable_capacity: "recovering",
          phase: "fading",
          last_hit_at: "2026-06-19T18:00:00.000Z",
          hours_since_last_hit: 20,
          advice: { recommendation: "wait", rationale: "recovering", suggested_intensity_pct: 70 },
          contributing_sessions: [],
        },
      ],
      tdee: {
        kcal: 2540,
        basis: "measured_intake",
        confidence: "established",
        source: "measured",
        window_days: 21,
        days_of_data: 21,
        components: {
          avg_kcal_in: { value: 1980, window_days: 21, days_with_data: 21 },
          trend_weight_change_kg: -0.6,
        },
      },
      trend_weight: {
        current_kg: 82.4,
        as_of: "2026-06-21",
        weight_change: { value_kg: -0.6, over_days: 14, confidence: "established" },
      },
      profile_complete: true,
      unexplained_gap: null,
      phase_adherence: { logged_days: 36, on_track_days: 28, avg_delta_kcal: -480 },
    },
    history_14d: [
      {
        date: "2026-06-07",
        day_totals: {
          kcal: 1910,
          protein_g: 165,
          carb_g: 180,
          fat_g: 55,
          kcal_from_food: 1910,
          kcal_from_alcohol: 0,
        },
        day_target: {
          target: { kcal: 2050, protein_g: 180, carb_g: 200, fat_g: 60 },
          maintenance: { kcal: 2540 },
          intake: { kcal: 1910, protein_g: 165, carb_g: 180, fat_g: 55 },
          observed: {
            cardio_kcal: 0,
            workout_kcal: 0,
            steps_kcal: 0,
            vs_target: -140,
            vs_maintenance: -630,
            status: "on_track",
          },
        },
        net_kcal: -560,
        untracked: false,
        meals_logged: true,
        workout_name: "LEGS",
      },
      {
        date: "2026-06-08",
        day_totals: {
          kcal: 2240,
          protein_g: 150,
          carb_g: 230,
          fat_g: 70,
          kcal_from_food: 2240,
          kcal_from_alcohol: 0,
        },
        day_target: {
          target: { kcal: 2050, protein_g: 180, carb_g: 200, fat_g: 60 },
          maintenance: { kcal: 2540 },
          intake: { kcal: 2240, protein_g: 150, carb_g: 230, fat_g: 70 },
          observed: {
            cardio_kcal: 0,
            workout_kcal: 0,
            steps_kcal: 0,
            vs_target: 190,
            vs_maintenance: -300,
            status: "at_risk",
          },
        },
        net_kcal: -150,
        untracked: false,
        meals_logged: true,
        workout_name: null,
      },
      {
        date: "2026-06-09",
        day_totals: {
          kcal: 0,
          protein_g: 0,
          carb_g: 0,
          fat_g: 0,
          kcal_from_food: 0,
          kcal_from_alcohol: 0,
        },
        day_target: null,
        net_kcal: null,
        untracked: true,
        meals_logged: false,
        workout_name: null,
      },
      {
        date: "2026-06-20",
        day_totals: {
          kcal: 1420,
          protein_g: 142,
          carb_g: 130,
          fat_g: 38,
          kcal_from_food: 1420,
          kcal_from_alcohol: 0,
        },
        day_target: {
          target: { kcal: 2050, protein_g: 180, carb_g: 200, fat_g: 60 },
          maintenance: { kcal: 2540 },
          intake: { kcal: 1420, protein_g: 142, carb_g: 130, fat_g: 38 },
          observed: {
            cardio_kcal: 0,
            workout_kcal: 0,
            steps_kcal: 0,
            vs_target: -630,
            vs_maintenance: -1120,
            status: "on_track",
          },
        },
        net_kcal: -1120,
        untracked: false,
        meals_logged: true,
        workout_name: "PUSH",
      },
    ],
    workouts: {
      window_from: "2026-05-11",
      window_label: "phase",
      total: 18,
      by_template: [
        { template_name: "Push", count: 7 },
        { template_name: "Pull", count: 6 },
        { template_name: "Legs", count: 5 },
      ],
    },
  };

  return { ...base, ...overrides };
}

describe("buildReportMarkdown", () => {
  it("fixture satisfies ShareReportSchema", () => {
    expect(ShareReportSchema.safeParse(makeReport()).success).toBe(true);
  });

  it("renders all sections, intro, and table header (happy path)", () => {
    const md = buildReportMarkdown(makeReport());
    expect(md).toContain("# Almanac stats — 2026-06-20");
    expect(md).toContain(
      "_This is my current nutrition and training data from Almanac. Help me interpret it._",
    );
    expect(md).toContain("_Snapshot for Jeff · America/Toronto · metric._");
    expect(md).toContain("## Phase");
    expect(md).toContain("## Today (2026-06-20)");
    expect(md).toContain("## Weight & TDEE");
    expect(md).toContain("## Workouts (this phase, since 2026-05-11)");
    expect(md).toContain("## This week (7-day)");
    expect(md).toContain("## Last 14 days");
    expect(md).toContain(
      "| Date | kcal | vs | P | C | F | cardio | workout | steps | net | status | trained | 🍺 | flag |",
    );
    // phase line
    expect(md).toContain("**Cut** (fat loss)");
    expect(md).toContain("day 40 of phase");
    expect(md).toContain("started 2026-05-11");
    expect(md).toContain("~10 days remaining");
    // target line uses thousands separators
    expect(md).toContain("Daily target: **2,050 kcal**");
    expect(md).toContain("180 P / 200 C / 60 F");
    // phase anchor vs calculated
    expect(md).toContain("Phase anchor TDEE 2,550 vs current calculated TDEE 2,540");
    expect(md).toContain("On target: **28 of 36 logged days**");
    // today
    expect(md).toContain("Intake so far: **1,420 kcal**");
    expect(md).toContain("Remaining vs target: 630 kcal");
    expect(md).toContain("Status: **on track**");
    expect(md).toContain("Energy balance: 1,420 in − 2,540 TDEE = **−1,120 net** today");
    // weight & tdee
    expect(md).toContain("Trend weight: **82.4 kg**");
    expect(md).toContain("Current TDEE: **2,540 kcal**");
    expect(md).toContain("measured intake, established");
    // this week
    expect(md).toContain("Avg intake: 1,980 kcal");
    expect(md).toContain("avg protein 168 g");
    expect(md).toContain("Sleep: avg 7.1 h/night · debt 4.2 h (8 h baseline)");
  });

  it("pre-computes the actual recent deficit (current TDEE − recent avg intake)", () => {
    // Obvious numbers so the assertion reads clearly: TDEE 2800 − avg intake 2000 = 800.
    const base = makeReport();
    const md = buildReportMarkdown(
      makeReport({
        context: {
          ...base.context,
          tdee: { ...base.context.tdee, kcal: 2800 },
          week_to_date: {
            ...base.context.week_to_date,
            avg_kcal_in: { value: 2000, window_days: 7, days_with_data: 7 },
          },
        },
      }),
    );
    expect(md).toContain(
      "Actual recent **deficit**: current TDEE 2,800 − recent avg intake (7-day) 2,000 = **800 kcal/day**",
    );
    expect(md).toContain("the planned deficit above is the target");
    expect(md).toContain("your phase target is a deficit");
  });

  it("frames the actual recent figure as a SURPLUS (off-plan) on a CUT when intake exceeds TDEE", () => {
    // TDEE 2400 − avg intake 2700 = −300 → surplus of 300 (off-plan for a cut).
    const base = makeReport();
    const md = buildReportMarkdown(
      makeReport({
        context: {
          ...base.context,
          tdee: { ...base.context.tdee, kcal: 2400 },
          week_to_date: {
            ...base.context.week_to_date,
            avg_kcal_in: { value: 2700, window_days: 7, days_with_data: 7 },
          },
        },
      }),
    );
    expect(md).toContain(
      "Actual recent balance: recent avg intake (7-day) 2,700 − current TDEE 2,400 = **+300 kcal/day SURPLUS** (you're eating above maintenance — off-plan for a cut; your phase target is a deficit).",
    );
    // never label a surplus as a "deficit", and never leak a unicode/ascii minus here
    expect(md).not.toContain("Actual recent **deficit**:");
    expect(md).not.toContain("= **−300");
    expect(md).not.toContain("= **-300");
  });

  it("names the biggest over-target day in the 14-day window (ranks, doesn't eyeball)", () => {
    // Three over-target days by KNOWN different amounts: A +200, B +505, C +100.
    // The line must name B (the max) — not the first/last/most-recent over day.
    const target = { kcal: 2050, protein_g: 180, carb_g: 200, fat_g: 60 };
    const overDay = (date: string, over: number) => ({
      date,
      day_totals: {
        kcal: 2050 + over,
        protein_g: 150,
        carb_g: 200,
        fat_g: 70,
        kcal_from_food: 2050 + over,
        kcal_from_alcohol: 0,
      },
      day_target: {
        target,
        maintenance: { kcal: 2540 },
        intake: { kcal: 2050 + over, protein_g: 150, carb_g: 200, fat_g: 70 },
        observed: {
          cardio_kcal: 0,
          workout_kcal: 0,
          steps_kcal: 0,
          vs_target: over,
          vs_maintenance: over - 490,
          status: "at_risk" as const,
        },
      },
      net_kcal: over - 490,
      untracked: false,
      meals_logged: true,
      workout_name: null,
    });
    const md = buildReportMarkdown(
      makeReport({
        history_14d: [
          overDay("2026-06-15", 200), // A
          overDay("2026-06-16", 505), // B — the biggest
          overDay("2026-06-17", 100), // C
        ],
      }),
    );
    expect(md).toContain(
      "Biggest overage in this 14-day window: **06-16** at +505 kcal vs target. (Use this for any 'biggest/worst miss' claim — do NOT eyeball the table.)",
    );
    // and it must NOT name the smaller over days as the biggest
    expect(md).not.toContain("**06-15** at +505");
    expect(md).not.toContain("**06-17** at +505");
  });

  it("omits the biggest-overage line when no day went over target", () => {
    // Every logged day is at or under target → no honest "biggest overage" exists.
    const target = { kcal: 2050, protein_g: 180, carb_g: 200, fat_g: 60 };
    const underDay = (date: string, under: number) => ({
      date,
      day_totals: {
        kcal: 2050 - under,
        protein_g: 165,
        carb_g: 180,
        fat_g: 55,
        kcal_from_food: 2050 - under,
        kcal_from_alcohol: 0,
      },
      day_target: {
        target,
        maintenance: { kcal: 2540 },
        intake: { kcal: 2050 - under, protein_g: 165, carb_g: 180, fat_g: 55 },
        observed: {
          cardio_kcal: 0,
          workout_kcal: 0,
          steps_kcal: 0,
          vs_target: -under,
          vs_maintenance: -under - 490,
          status: "on_track" as const,
        },
      },
      net_kcal: -under - 490,
      untracked: false,
      meals_logged: true,
      workout_name: null,
    });
    const md = buildReportMarkdown(
      makeReport({
        history_14d: [underDay("2026-06-18", 140), underDay("2026-06-19", 300)],
      }),
    );
    expect(md).not.toContain("Biggest overage");
  });

  it("ignores untracked/unlogged days when ranking the biggest overage", () => {
    // An untracked day with no target (and a 0-kcal unlogged day) must never be
    // counted as an overage; the only real over-target day wins.
    const target = { kcal: 2050, protein_g: 180, carb_g: 200, fat_g: 60 };
    const md = buildReportMarkdown(
      makeReport({
        history_14d: [
          // untracked day — no target, must be skipped
          {
            date: "2026-06-12",
            day_totals: {
              kcal: 0,
              protein_g: 0,
              carb_g: 0,
              fat_g: 0,
              kcal_from_food: 0,
              kcal_from_alcohol: 0,
            },
            day_target: null,
            net_kcal: null,
            untracked: true,
            meals_logged: false,
            workout_name: null,
          },
          // the one real over-target day
          {
            date: "2026-06-13",
            day_totals: {
              kcal: 2400,
              protein_g: 150,
              carb_g: 230,
              fat_g: 70,
              kcal_from_food: 2400,
              kcal_from_alcohol: 0,
            },
            day_target: {
              target,
              maintenance: { kcal: 2540 },
              intake: { kcal: 2400, protein_g: 150, carb_g: 230, fat_g: 70 },
              observed: {
                cardio_kcal: 0,
                workout_kcal: 0,
                steps_kcal: 0,
                vs_target: 350,
                vs_maintenance: -140,
                status: "at_risk" as const,
              },
            },
            net_kcal: -140,
            untracked: false,
            meals_logged: true,
            workout_name: null,
          },
        ],
      }),
    );
    expect(md).toContain(
      "Biggest overage in this 14-day window: **06-13** at +350 kcal vs target.",
    );
  });

  // --- Phase-aware framing: BULK -------------------------------------------
  // Build a bulk phase + a bulk-shaped fixture. On a bulk the user WANTS a
  // surplus, so a surplus is the on-plan figure and the "miss" is the most
  // UNDER-target day (under-eating slows gains).
  function makeBulkReport(overrides: Partial<ShareReport> = {}): ShareReport {
    const base = makeReport();
    const phase = base.context.phase;
    if (phase === null) throw new Error("fixture must have a phase");
    return makeReport({
      context: {
        ...base.context,
        phase: {
          ...phase,
          name: "Lean Bulk",
          intent: "bulk",
          phase_type: "bulk",
          deficit_kcal: 300, // intended POSITIVE balance (a surplus)
        },
        // TDEE 2,500, recent avg intake 2,800 → 300/day SURPLUS (on-plan).
        tdee: { ...base.context.tdee, kcal: 2500 },
        week_to_date: {
          ...base.context.week_to_date,
          avg_kcal_in: { value: 2800, window_days: 7, days_with_data: 7 },
        },
      },
      ...overrides,
    });
  }

  it("BULK: frames the on-plan figure as a SURPLUS (intake − TDEE)", () => {
    const md = buildReportMarkdown(makeBulkReport());
    expect(md).toContain(
      "Actual recent **surplus**: recent avg intake (7-day) 2,800 − current TDEE 2,500 = **300 kcal/day**",
    );
    // a bulk surplus must never be framed as a deficit
    expect(md).not.toContain("Actual recent **deficit**:");
    expect(md).not.toContain("DEFICIT");
  });

  it("BULK: a deficit is off-plan (eating below maintenance — may not be gaining)", () => {
    const base = makeBulkReport();
    const md = buildReportMarkdown(
      makeBulkReport({
        context: {
          ...base.context,
          // TDEE 2,500, recent avg intake 2,200 → 300/day DEFICIT (off-plan).
          tdee: { ...base.context.tdee, kcal: 2500 },
          week_to_date: {
            ...base.context.week_to_date,
            avg_kcal_in: { value: 2200, window_days: 7, days_with_data: 7 },
          },
        },
      }),
    );
    expect(md).toContain(
      "Actual recent balance: current TDEE 2,500 − recent avg intake (7-day) 2,200 = **300 kcal/day DEFICIT** (you're eating below maintenance — off-plan for a bulk; you may not be gaining; your phase target is a surplus).",
    );
  });

  it("BULK: biggest 'miss' is the most UNDER-target day (a shortfall), not the most over", () => {
    // Days vs target 2050: A +300 (over — NOT a bulk miss), B −400 (under, the
    // biggest shortfall), C −150 (under, smaller). Must name B at −400.
    const target = { kcal: 2050, protein_g: 180, carb_g: 200, fat_g: 60 };
    const day = (date: string, over: number) => ({
      date,
      day_totals: {
        kcal: 2050 + over,
        protein_g: 150,
        carb_g: 200,
        fat_g: 70,
        kcal_from_food: 2050 + over,
        kcal_from_alcohol: 0,
      },
      day_target: {
        target,
        maintenance: { kcal: 2540 },
        intake: { kcal: 2050 + over, protein_g: 150, carb_g: 200, fat_g: 70 },
        observed: {
          cardio_kcal: 0,
          workout_kcal: 0,
          steps_kcal: 0,
          vs_target: over,
          vs_maintenance: over - 490,
          status: "at_risk" as const,
        },
      },
      net_kcal: over - 490,
      untracked: false,
      meals_logged: true,
      workout_name: null,
    });
    const md = buildReportMarkdown(
      makeBulkReport({
        history_14d: [day("2026-06-15", 300), day("2026-06-16", -400), day("2026-06-17", -150)],
      }),
    );
    expect(md).toContain(
      "Biggest shortfall in this 14-day window: **06-16** at −400 kcal vs target (under-eating slows gains). (Use this for any 'biggest/worst miss' claim — do NOT eyeball the table.)",
    );
    // it must NOT call the over day or the smaller shortfall the biggest miss
    expect(md).not.toContain("Biggest overage");
    expect(md).not.toContain("**06-15**");
    expect(md).not.toContain("**06-17** at −400");
  });

  it("BULK: omits the biggest-shortfall line when no day went under target", () => {
    // Every logged day is at or over target → no honest "shortfall" exists.
    const target = { kcal: 2050, protein_g: 180, carb_g: 200, fat_g: 60 };
    const overDay = (date: string, over: number) => ({
      date,
      day_totals: {
        kcal: 2050 + over,
        protein_g: 165,
        carb_g: 220,
        fat_g: 70,
        kcal_from_food: 2050 + over,
        kcal_from_alcohol: 0,
      },
      day_target: {
        target,
        maintenance: { kcal: 2540 },
        intake: { kcal: 2050 + over, protein_g: 165, carb_g: 220, fat_g: 70 },
        observed: {
          cardio_kcal: 0,
          workout_kcal: 0,
          steps_kcal: 0,
          vs_target: over,
          vs_maintenance: over - 490,
          status: "on_track" as const,
        },
      },
      net_kcal: over - 490,
      untracked: false,
      meals_logged: true,
      workout_name: null,
    });
    const md = buildReportMarkdown(
      makeBulkReport({ history_14d: [overDay("2026-06-18", 120), overDay("2026-06-19", 300)] }),
    );
    expect(md).not.toContain("Biggest shortfall");
    expect(md).not.toContain("Biggest overage");
    expect(md).not.toContain("Biggest deviation");
  });

  // --- Phase-aware framing: MAINTENANCE ------------------------------------
  function makeMaintReport(overrides: Partial<ShareReport> = {}): ShareReport {
    const base = makeReport();
    const phase = base.context.phase;
    if (phase === null) throw new Error("fixture must have a phase");
    return makeReport({
      context: {
        ...base.context,
        phase: {
          ...phase,
          name: "Maintain",
          intent: "maintenance",
          phase_type: "maintenance",
          deficit_kcal: 0,
        },
        // TDEE 2,500, recent avg intake 2,650 → −150 signed delta from even.
        tdee: { ...base.context.tdee, kcal: 2500 },
        week_to_date: {
          ...base.context.week_to_date,
          avg_kcal_in: { value: 2650, window_days: 7, days_with_data: 7 },
        },
      },
      ...overrides,
    });
  }

  it("MAINTENANCE: frames the figure as a signed ENERGY BALANCE, neither direction alarming", () => {
    const md = buildReportMarkdown(makeMaintReport());
    // TDEE 2,500 vs intake 2,650 → −150 from even.
    expect(md).toContain(
      "Actual recent **energy balance**: current TDEE 2,500 vs recent avg intake (7-day) 2,650 = **−150 kcal/day** (your phase target is an even balance; this is how far from even you are).",
    );
    expect(md).not.toContain("SURPLUS");
    expect(md).not.toContain("DEFICIT");
  });

  it("MAINTENANCE: biggest 'miss' is the largest swing EITHER direction (by absolute value)", () => {
    // Days vs target 2050: A +250 (over), B −400 (under, largest |swing|), C +100.
    // Must name B at −400, the largest absolute deviation in either direction.
    const target = { kcal: 2050, protein_g: 180, carb_g: 200, fat_g: 60 };
    const day = (date: string, over: number) => ({
      date,
      day_totals: {
        kcal: 2050 + over,
        protein_g: 150,
        carb_g: 200,
        fat_g: 70,
        kcal_from_food: 2050 + over,
        kcal_from_alcohol: 0,
      },
      day_target: {
        target,
        maintenance: { kcal: 2540 },
        intake: { kcal: 2050 + over, protein_g: 150, carb_g: 200, fat_g: 70 },
        observed: {
          cardio_kcal: 0,
          workout_kcal: 0,
          steps_kcal: 0,
          vs_target: over,
          vs_maintenance: over - 490,
          status: "at_risk" as const,
        },
      },
      net_kcal: over - 490,
      untracked: false,
      meals_logged: true,
      workout_name: null,
    });
    const md = buildReportMarkdown(
      makeMaintReport({
        history_14d: [day("2026-06-15", 250), day("2026-06-16", -400), day("2026-06-17", 100)],
      }),
    );
    expect(md).toContain(
      "Biggest deviation in this 14-day window: **06-16** at −400 kcal vs target. (Use this for any 'biggest/worst miss' claim — do NOT eyeball the table.)",
    );
    expect(md).not.toContain("Biggest overage");
    expect(md).not.toContain("Biggest shortfall");
    expect(md).not.toContain("**06-15**");
  });

  it("omits the actual-deficit line when recent intake is unknown (days_with_data 0)", () => {
    // No recent intake → a deficit computed against 0 would be garbage; skip it.
    const base = makeReport();
    const md = buildReportMarkdown(
      makeReport({
        context: {
          ...base.context,
          week_to_date: {
            ...base.context.week_to_date,
            avg_kcal_in: { value: 0, window_days: 7, days_with_data: 0 },
          },
        },
      }),
    );
    expect(md).not.toContain("Actual recent deficit:");
    expect(md).not.toContain("Actual recent balance:");
  });

  it("omits the actual-deficit line when there is no active phase", () => {
    const base = makeReport();
    const md = buildReportMarkdown(
      makeReport({
        context: {
          ...base.context,
          phase: null,
          today: { ...base.context.today, target: null, maintenance: null, observed: null },
        },
      }),
    );
    expect(md).not.toContain("Actual recent deficit:");
    expect(md).not.toContain("Actual recent balance:");
  });

  it("uses unicode minus for signed deltas", () => {
    const md = buildReportMarkdown(makeReport());
    expect(md).toContain("−480");
    expect(md).not.toContain("-480");
  });

  it("renders the deficit as a magnitude regardless of stored sign", () => {
    const phase = makeReport().context.phase;
    if (phase === null) throw new Error("fixture must have a phase");
    // Real cuts store deficit_kcal negative; the line should still read "deficit 500/day".
    const md = buildReportMarkdown(
      makeReport({
        context: { ...makeReport().context, phase: { ...phase, deficit_kcal: -500 } },
      }),
    );
    expect(md).toContain("(deficit 500/day)");
    expect(md).not.toContain("deficit -500/day");
    expect(md).not.toContain("deficit −500/day");
  });

  it("renders a zero delta as plain 0, not +0", () => {
    const change = makeReport().context.trend_weight.weight_change;
    if (change === null) throw new Error("fixture must have a weight_change");
    const md = buildReportMarkdown(
      makeReport({
        context: {
          ...makeReport().context,
          trend_weight: {
            ...makeReport().context.trend_weight,
            weight_change: { ...change, value_kg: 0 },
          },
        },
      }),
    );
    expect(md).toContain("(0 kg over");
    expect(md).not.toContain("+0 kg");
  });

  it("rounds fractional macros — no float noise in Today intake/remaining", () => {
    // Real meal macros are fractional; target−intake must not leak e.g.
    // "1.5999999999999943 P". Today intake P=178.4, target P=180 → remaining 2 P.
    const base = makeReport();
    const today = base.context.today;
    if (today.target === null) throw new Error("fixture must have today.target");
    const md = buildReportMarkdown(
      makeReport({
        context: {
          ...base.context,
          today: {
            ...today,
            intake: { ...today.intake, protein_g: 178.4, carb_g: 164.2, fat_g: 83.5 },
            target: { ...today.target, protein_g: 180, carb_g: 165, fat_g: 60 },
          },
        },
      }),
    );
    // No long fractional tail anywhere.
    expect(md).not.toMatch(/\.\d{3,}/);
    expect(md).toContain("178 P / 164 C / 84 F"); // intake rounded to whole grams
    // remaining: P 180−178.4=1.6→2, C 165−164.2=0.8→1, F 60−83.5=−23.5→−23 (JS
    // rounds half toward +∞). Whole grams, no float tail.
    expect(md).toMatch(/Remaining vs target:.*2 P \/ 1 C \/ -23 F/);
  });

  it("renders remaining kcal as a magnitude when under budget, unicode-minus when over", () => {
    const base = makeReport();
    const today = base.context.today;
    if (today.target === null) throw new Error("fixture must have today.target");
    // under budget: intake 1420, target 2050 → 630 remaining, no + sign
    const under = buildReportMarkdown(makeReport());
    expect(under).toContain("Remaining vs target: 630 kcal");
    expect(under).not.toContain("Remaining vs target: +630");
    // over budget: intake 2200 vs target 2050 → −150
    const over = buildReportMarkdown(
      makeReport({
        context: {
          ...base.context,
          today: { ...today, intake: { ...today.intake, kcal: 2200 } },
        },
      }),
    );
    expect(over).toContain("Remaining vs target: −150 kcal");
    expect(over).not.toContain("-150 kcal"); // unicode minus, not ascii
  });

  it("imperial user renders weight in lb, not kg", () => {
    const md = buildReportMarkdown(
      makeReport({
        context: {
          ...makeReport().context,
          user: {
            id: 1,
            name: "Jeff",
            timezone: "America/Toronto",
            preferred_unit_system: "imperial",
            activity_level: "moderate",
          },
        },
      }),
    );
    expect(md).toMatch(/ lb/);
    expect(md).not.toContain("82.4 kg");
  });

  it("renders the user's activity level when set", () => {
    const md = buildReportMarkdown(makeReport()); // fixture user.activity_level = "moderate"
    expect(md).toContain("Activity: moderate");
  });

  it("omits the activity line when activity_level is null", () => {
    const base = makeReport();
    const md = buildReportMarkdown({
      ...base,
      context: { ...base.context, user: { ...base.context.user, activity_level: null } },
    });
    expect(md).not.toContain("Activity:");
  });

  it("no phase: shows no-phase line, last-14-days workouts heading, omits remaining/status", () => {
    const base = makeReport();
    const md = buildReportMarkdown(
      makeReport({
        context: {
          ...base.context,
          phase: null,
          today: { ...base.context.today, target: null, maintenance: null, observed: null },
        },
        workouts: { ...base.workouts, window_label: "last_14_days" },
      }),
    );
    expect(md).toContain("## Phase\n- No active nutrition phase.");
    expect(md).toContain("## Workouts (last 14 days)");
    expect(md).not.toContain("Remaining vs target");
    expect(md).not.toContain("Status:");
    // intake + energy balance still present
    expect(md).toContain("Intake so far:");
    expect(md).toContain("Energy balance:");
  });

  it("profile_baseline TDEE renders calibrating copy", () => {
    const base = makeReport();
    const md = buildReportMarkdown(
      makeReport({
        context: {
          ...base.context,
          tdee: {
            ...base.context.tdee,
            basis: "profile_baseline",
            confidence: "early",
            source: "formula",
            components: {
              avg_kcal_in: { value: 0, window_days: 0, days_with_data: 0 },
              trend_weight_change_kg: 0,
              days_remaining_to_calibrate: 6,
            },
          },
        },
      }),
    );
    expect(md).toContain("estimated TDEE — calibrating");
    expect(md).toContain("(6 days to go)");
  });

  it("no weight logged yet", () => {
    const base = makeReport();
    const md = buildReportMarkdown(
      makeReport({
        context: {
          ...base.context,
          trend_weight: { current_kg: null, as_of: null, weight_change: null },
        },
      }),
    );
    expect(md).toContain("No weight logged yet");
  });

  it("empty stim_states omits training readiness line", () => {
    const base = makeReport();
    const md = buildReportMarkdown(makeReport({ context: { ...base.context, stim_states: [] } }));
    expect(md).not.toContain("Training readiness now:");
  });

  it("renders training readiness from stim_states with humanized phase labels", () => {
    const md = buildReportMarkdown(makeReport());
    expect(md).toContain("Training readiness now:");
    // phase enums are humanized: "prime" → "prime window", "fading" → "fading"
    expect(md).toContain("Chest fresh (prime window)");
    expect(md).toContain("Back recovering (fading)");
    // raw enum value must NOT leak
    expect(md).not.toMatch(/\(prime\)/);
  });

  it("humanizes every stim phase enum (no raw too_soon/detrained/in_window leaks)", () => {
    const base = makeReport();
    const first = base.context.stim_states[0];
    if (first === undefined) throw new Error("fixture must have stim_states");
    const cases: Array<[string, string]> = [
      ["too_soon", "needs more rest"],
      ["acceptable", "ready"],
      ["prime", "prime window"],
      ["in_window", "still primed"],
      ["fading", "fading"],
      ["detrained", "long layoff"],
    ];
    for (const [raw, friendly] of cases) {
      const md = buildReportMarkdown(
        makeReport({
          context: {
            ...base.context,
            stim_states: [{ ...first, group_name: "Chest", phase: raw as typeof first.phase }],
          },
        }),
      );
      expect(md).toContain(`Chest ${first.trainable_capacity} (${friendly})`);
    }
    // none of the raw enum tokens should appear in the readiness output
    const md = buildReportMarkdown(makeReport());
    for (const raw of ["too_soon", "detrained", "in_window"]) {
      expect(md).not.toContain(`(${raw})`);
    }
  });

  it("untracked day row renders dashes and an untracked flag", () => {
    const md = buildReportMarkdown(makeReport());
    const row = md.split("\n").find((l) => l.startsWith("| 06-09 |"));
    if (row === undefined) throw new Error("06-09 row not found");
    // every data cell is a dash (no macros, no activity, no status/trained)
    expect(row).toBe("| 06-09 | — | — | — | — | — | — | — | — | — | — | — |  | untracked |");
  });

  it("a day with no meals logged renders dashes + a 'not logged' flag (not a real 0)", () => {
    const base = makeReport();
    // Turn 06-07 (a normal logged day) into an unlogged day: zero totals, no
    // meals, NOT untracked. It must read "not logged", not "1,910 / −140".
    const history = base.history_14d.map((d) =>
      d.date === "2026-06-07"
        ? {
            ...d,
            meals_logged: false,
            day_totals: { ...d.day_totals, kcal: 0, protein_g: 0 },
            day_target: null,
            net_kcal: null,
          }
        : d,
    );
    const md = buildReportMarkdown(makeReport({ history_14d: history }));
    const row = md.split("\n").find((l) => l.startsWith("| 06-07 |"));
    if (row === undefined) throw new Error("06-07 row not found");
    // macros + activity + net dash (no intake / no target), but the workout was
    // still done that day — "trained" keeps the template name even when food
    // wasn't logged. Flag reads "not logged".
    expect(row).toBe("| 06-07 | — | — | — | — | — | — | — | — | — | — | LEGS |  | not logged |");
  });

  it("today row gets a partial flag", () => {
    const md = buildReportMarkdown(makeReport());
    expect(md).toContain("(today, partial)");
  });

  it("a logged day renders the full per-day mirror (macros, activity, status, trained)", () => {
    // 06-07 fixture: kcal 1910, P/C/F 165/180/55, on_track, trained LEGS, no drink.
    const md = buildReportMarkdown(makeReport());
    const row = md.split("\n").find((l) => l.startsWith("| 06-07 |"));
    if (row === undefined) throw new Error("06-07 row not found");
    expect(row).toBe(
      "| 06-07 | 1,910 | −140 | 165 | 180 | 55 | 0 | 0 | 0 | −560 | on track | LEGS |  |  |",
    );
  });

  it("marks a drinking day with a beer emoji", () => {
    const base = makeReport();
    const history = base.history_14d.map((d) =>
      d.date === "2026-06-08"
        ? { ...d, day_totals: { ...d.day_totals, kcal_from_alcohol: 300 } }
        : d,
    );
    const md = buildReportMarkdown(makeReport({ history_14d: history }));
    const row = md.split("\n").find((l) => l.startsWith("| 06-08 |"));
    if (row === undefined) throw new Error("06-08 row not found");
    expect(row).toContain("🍺");
  });

  it("Today section reads 'No meals logged yet' when nothing is logged (no false on-track)", () => {
    const base = makeReport();
    const md = buildReportMarkdown(
      makeReport({
        context: {
          ...base.context,
          today: { ...base.context.today, meals_logged_today: false },
        },
      }),
    );
    expect(md).toContain("No meals logged yet today.");
    // the misleading lines must be gone
    expect(md).not.toContain("Intake so far:");
    expect(md).not.toContain("Remaining vs target:");
    expect(md).not.toMatch(/Status:.*on track/);
    // energy balance still shown (it's factual: 0 − TDEE)
    expect(md).toContain("Energy balance:");
  });

  it("Today section keeps the full breakdown when meals ARE logged", () => {
    const md = buildReportMarkdown(makeReport()); // fixture has meals_logged_today: true
    expect(md).toContain("Intake so far:");
    expect(md).toContain("Remaining vs target:");
    expect(md).not.toContain("No meals logged yet today.");
  });

  it("renders by_template with × counts and weekly frequency", () => {
    const md = buildReportMarkdown(makeReport());
    expect(md).toContain("By type:");
    expect(md).toContain("Push ×7");
    expect(md).toContain("Pull ×6");
    expect(md).toContain("Legs ×5");
    expect(md).toMatch(/\/ week/);
  });

  it("dashes the steps column when the day has no step log, but cardio still prints 0", () => {
    // 06-07 fixture has cardio_kcal: 0, steps_kcal: 0 — null out only steps_kcal
    // so the two columns can be told apart: not logging cardio genuinely means
    // no cardio burn (0), but an absent step log says nothing about whether the
    // user walked (dash).
    const base = makeReport();
    const history = base.history_14d.map((d) => {
      if (d.date !== "2026-06-07" || d.day_target === null) return d;
      return {
        ...d,
        day_target: {
          ...d.day_target,
          observed: { ...d.day_target.observed, steps_kcal: null },
        },
      };
    });
    const md = buildReportMarkdown(makeReport({ history_14d: history }));
    const row = md.split("\n").find((l) => l.startsWith("| 06-07 |"));
    if (row === undefined) throw new Error("06-07 row not found");
    const cells = row.split("|").map((c) => c.trim());
    // | Date | kcal | vs | P | C | F | cardio | workout | steps | net | status | trained | 🍺 | flag |
    const cardioCol = cells[7];
    const stepsCol = cells[9];
    if (cardioCol === undefined || stepsCol === undefined) {
      throw new Error("row did not split into the expected number of columns");
    }
    expect(cardioCol).toBe("0");
    expect(stepsCol).toBe("—");
  });

  it("empty by_template replaces the by-type line", () => {
    const md = buildReportMarkdown(
      makeReport({
        workouts: {
          window_from: "2026-05-11",
          window_label: "phase",
          total: 0,
          by_template: [],
        },
      }),
    );
    expect(md).toContain("No workouts logged in this window.");
  });
});
