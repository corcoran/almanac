import type { TdeeSource } from "../domain/nutrition.js";
import { currentUserDate } from "../domain/user-day.js";
import type { ActivityLevel } from "../domain/users.js";
import { type Aggregate, makeAggregate } from "./aggregate.js";
import { first, last, median, requireNonEmpty } from "./array.js";
import {
  ACTIVITY_MULTIPLIERS,
  DEFAULT_TDEE_CONFIG,
  DEFAULT_TREND_WEIGHT_CONFIG,
  type TdeeConfig,
} from "./config.js";
import { computeTrendWeight } from "./trend-weight.js";

/**
 * TDEE follows the helpful-early contract: never null, always returns a
 * usable number. `basis` and `confidence` tell the caller how to trust it.
 *
 * - `basis: "profile_baseline"` — Mifflin BMR × activity multiplier from the
 *   user's profile. Used when we don't yet have enough measured data.
 * - `basis: "measured_intake"` — Back-calculated from logged kcal in and the
 *   trend-weight delta over the analysis window.
 *
 * `confidence` is intentionally binary to keep the surface simple for LLM
 * clients (the gaps audit called out the four-tier "seeding | low | medium |
 * high" as more noise than signal):
 * - `early`        — profile_baseline, or measured_intake with thin data.
 * - `established`  — measured_intake with >= `establishedThresholdDays`
 *                    of weight data.
 */
export type TDEE = {
  kcal: number;
  basis: "profile_baseline" | "measured_intake";
  confidence: "early" | "established";
  source: TdeeSource;
  window_days: number;
  days_of_data: number;
  components: {
    // Aggregate so the windowing is visible at the call site — distinguishes
    // TDEE's own intake-average window from the week_to_date one (Gap 20).
    avg_kcal_in: Aggregate;
    trend_weight_change_kg: number;
    days_remaining_to_calibrate?: number;
    // Set when the meal-days guard trips (enough weight data, too few meal
    // days for an honest back-calc). Mirrors days_remaining_to_calibrate
    // so callers can show "log N more meals to enable measured TDEE".
    meal_days_remaining_to_calibrate?: number;
    // Count of window days the user marked untracked. 0 when none — surfaced so
    // a consumer can see why measured TDEE is computed over thin data.
    // Measured-intake path only; absent on profile_baseline returns.
    untracked_days_in_window?: number;
  };
};

export type TdeeInput = {
  asOf: string;
  bodyWeights: Array<{ measured_on: string; weight_kg: number }>;
  meals: Array<{ eaten_at: string; kcal: number }>;
  alcoholSessions: Array<{ started_at: string; est_kcal: number }>;
  user: {
    dob: string | null;
    height_cm: number | null;
    sex: "male" | "female" | null;
    latestWeightKg: number | null;
    activity_level: ActivityLevel | null;
  };
  /**
   * Days (YYYY-MM-DD) the user marked as untracked (vacation/sick/deload).
   * Excluded from the intake average AND the weight-delta endpoints so a
   * logging gap doesn't bias measured TDEE low. Pass `new Set()` for "no
   * exclusions" — the caller fetches this via getUntrackedDays(...).
   */
  untrackedDays: Set<string>;
  /**
   * IANA timezone (e.g. "America/New_York") used to bucket each meal/alcohol
   * session to a user-local calendar day via `currentUserDate`. The window
   * loop iterates user-local dates, so meals must be bucketed the same way —
   * UTC `.slice(0, 10)` would mis-bucket evening meals for non-UTC users.
   */
  tz: string;
};

function ageYears(dob: string | null, asOf: string): number | null {
  if (!dob) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${dob}T00:00:00Z`);
  return Math.floor((a - b) / (365.25 * 24 * 3600 * 1000));
}

function bmrMifflin(
  weightKg: number,
  heightCm: number,
  age: number,
  sex: "male" | "female",
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type TrendPoint = { date: string; trend_kg: number };

/** The first up-to-3 elements (fewer if the array is shorter). */
function firstUpTo3<T>(xs: readonly T[]): T[] {
  return xs.slice(0, 3);
}

/** The last up-to-3 elements (fewer if the array is shorter). */
function lastUpTo3<T>(xs: readonly T[]): T[] {
  return xs.slice(-3);
}

/**
 * Median trend_kg of the given points, or `fallback` when the list is empty
 * (degenerate stale-weight case where nothing tracked landed in-window).
 */
function medianTrend(points: readonly TrendPoint[], fallback: number): number {
  if (points.length === 0) return fallback;
  return median(
    requireNonEmpty(
      points.map((p) => p.trend_kg),
      "medianTrend values",
    ),
  );
}

function profileBaselineTDEE(
  input: TdeeInput,
  config: TdeeConfig,
  extraComponents: Partial<TDEE["components"]>,
): TDEE {
  const age = ageYears(input.user.dob, input.asOf) ?? 30;
  const height = input.user.height_cm ?? 175;
  const weight = input.user.latestWeightKg ?? 80;
  const sex = input.user.sex ?? "male";
  const multiplier =
    input.user.activity_level != null
      ? ACTIVITY_MULTIPLIERS[input.user.activity_level]
      : config.seedActivityMultiplier;
  const bmr = bmrMifflin(weight, height, age, sex);
  return {
    kcal: Math.round(bmr * multiplier),
    basis: "profile_baseline",
    confidence: "early",
    source: "formula",
    window_days: 0,
    days_of_data: input.bodyWeights.length,
    components: {
      avg_kcal_in: makeAggregate(0, 0, 0),
      trend_weight_change_kg: 0,
      ...extraComponents,
    },
  };
}

export function computeTDEE(input: TdeeInput, config: TdeeConfig = DEFAULT_TDEE_CONFIG): TDEE {
  const days = input.bodyWeights.length;

  if (days < config.fallbackWindowDays) {
    // Profile-baseline tier — not enough weight data for back-calc.
    return profileBaselineTDEE(input, config, {
      days_remaining_to_calibrate: config.fallbackWindowDays - days,
    });
  }

  // Window scales with available data, floored at the measured-eligibility
  // threshold and capped at maxBackcalcWindowDays. A wider window de-weights a
  // single window-edge weight spike that a 21-day window read as a too-fast loss.
  const windowDays = Math.min(
    Math.max(days, config.fallbackWindowDays),
    config.maxBackcalcWindowDays,
  );
  const start = addDays(input.asOf, -(windowDays - 1));

  // Sum kcal per day across the window. `daysWithData` counts days where any
  // intake (meal or alcohol) was logged — used as the honest denominator for
  // the back-calc and the meal-days guard. The window iteration runs even
  // when no meals exist so daysWithData is computed correctly.
  // Bucket every meal + alcohol session to its user-local day once. Each
  // currentUserDate call builds an Intl formatter, so do it per-row, not
  // per-row-per-window-day. Untracked-day and out-of-window totals land in the
  // Map but are never read (the window loop skips untracked dates and only
  // looks up dates it iterates), so behavior matches summing inside the loop.
  const kcalByDay = new Map<string, number>();
  for (const m of input.meals) {
    const day = currentUserDate(new Date(m.eaten_at), input.tz);
    kcalByDay.set(day, (kcalByDay.get(day) ?? 0) + m.kcal);
  }
  for (const a of input.alcoholSessions) {
    const day = currentUserDate(new Date(a.started_at), input.tz);
    kcalByDay.set(day, (kcalByDay.get(day) ?? 0) + a.est_kcal);
  }

  let kcalSum = 0;
  let daysWithData = 0;
  let untrackedInWindow = 0;
  for (let d = 0; d < windowDays; d++) {
    const date = addDays(start, d);
    if (input.untrackedDays.has(date)) {
      untrackedInWindow++;
      continue; // contributes nothing to kcalSum or daysWithData
    }
    const dayKcal = kcalByDay.get(date) ?? 0;
    if (dayKcal > 0) daysWithData++;
    kcalSum += dayKcal;
  }

  // Meal-days guard: even with enough weight data, the back-calc needs a
  // floor of logged-meal days or the per-day intake estimate is too noisy
  // (and on a vacation-style zero-meal stretch, silently bottoms TDEE to BMR).
  // Below the threshold, fall back to profile_baseline with a diagnostic
  // hint so callers can tell the user "log N more meal days".
  if (daysWithData < config.minMealDaysForBackcalc) {
    return profileBaselineTDEE(input, config, {
      meal_days_remaining_to_calibrate: config.minMealDaysForBackcalc - daysWithData,
    });
  }

  // Per-logged-day average — the denominator is days with data, not the window.
  const avgKcalIn = kcalSum / daysWithData;
  const avgKcalInWrapper = makeAggregate(avgKcalIn, windowDays, daysWithData);

  // trend weight change. trend is non-empty here: days >= fallbackWindowDays
  // (>= 14) means input.bodyWeights had at least 14 entries, and
  // computeTrendWeight emits one point per day from first to last reading, so
  // it yields >= 14 points. requireNonEmpty turns that invariant into a thrown
  // error if it's ever violated, instead of a silent undefined downstream.
  const trend = requireNonEmpty(
    computeTrendWeight(input.bodyWeights, DEFAULT_TREND_WEIGHT_CONFIG),
    "tdee trend (expected >=1 point when days >= fallbackWindowDays)",
  );
  // Endpoints snap to TRACKED days only. A vacation at the window edge would
  // otherwise stretch the weight-change time-base without contributing intake,
  // biasing measured TDEE low (the design's core fix). We pick the earliest
  // and latest trend points inside the window that aren't untracked.
  const inWindowAny = trend.filter((p) => p.date >= start);
  const inWindowTracked = inWindowAny.filter((p) => !input.untrackedDays.has(p.date));

  // Endpoints are the MEDIAN of up to the first / last 3 tracked in-window trend
  // points, not a single point. A lone window-edge water spike can't set the
  // whole slope. Fallbacks (inWindowAny / full-trend ends) cover the degenerate
  // stale-weight case where nothing tracked lands in-window.
  const startTrend = medianTrend(
    firstUpTo3(inWindowTracked),
    inWindowAny[0]?.trend_kg ?? first(trend).trend_kg,
  );
  const endTrend = medianTrend(lastUpTo3(inWindowTracked), last(trend).trend_kg);
  const deltaKg = endTrend - startTrend;

  // IMPORTANT: do NOT add a steps term (or any other explicit activity term) to
  // the energy-balance equation below. The trend-weight signal already
  // integrates NEAT, cardio, and resistance training into the body-mass
  // trajectory — `(deltaKg × kcalPerKg) / windowDays` IS the net activity
  // contribution. Piping `step_logs.est_kcal` in here would double-count NEAT
  // against itself. Steps belong in per-day display (`signals/today.ts`) and
  // the avg-activity baseline (`signals/avg-activity.ts`), not here.
  //
  // Floor the energy-balance estimate at BMR so pathological inputs
  // (extreme under-eating + rapid weight gain) can't produce a negative or
  // sub-resting "TDEE" — the schema guarantees `kcal > 0`.
  const age = ageYears(input.user.dob, input.asOf) ?? 30;
  const height = input.user.height_cm ?? 175;
  const weight = input.user.latestWeightKg ?? 80;
  const sex = input.user.sex ?? "male";
  const bmr = bmrMifflin(weight, height, age, sex);
  const tdee = Math.max(bmr, avgKcalIn - (deltaKg * config.kcalPerKg) / windowDays);

  const confidence: TDEE["confidence"] =
    days >= config.establishedThresholdDays ? "established" : "early";

  return {
    kcal: Math.round(tdee),
    basis: "measured_intake",
    confidence,
    source: "measured",
    window_days: windowDays,
    days_of_data: days,
    components: {
      avg_kcal_in: avgKcalInWrapper,
      trend_weight_change_kg: Number(deltaKg.toFixed(2)),
      untracked_days_in_window: untrackedInWindow,
    },
  };
}
