import { type CardioKcalConfig, DEFAULT_CARDIO_KCAL_CONFIG } from "./config.js";

/**
 * Estimate kcal burned for a cardio session from heart-rate data, when the
 * user logged one. Two underlying formulas:
 *
 *   - **Keytel et al. (2005)** — back-calculates kcal from avg_hr using
 *     sex, weight, and age. The standard HR-based estimator in
 *     sports-science literature.
 *
 *   - **METs midpoint** — `kcal = METs × 3.5 × weight_kg / 200 × min`, with
 *     a single default MET constant (config-driven). Modality-aware tables
 *     exist (ACSM compendium) but a single-constant approach is what we
 *     picked for v1 — keeps the surface tiny, and the midpoint with Keytel
 *     smooths over modality-specific error.
 *
 * The returned `est_kcal_hr` is the **midpoint** of the two. When the user
 * profile is missing fields Keytel needs (sex, weight, dob), we fall back
 * to METs-only so the estimate still produces something — `basis` tells
 * callers which formula(s) were available.
 */

export type CardioKcalEstimateInput = {
  avg_hr: number;
  duration_min: number;
  user: {
    /** ISO YYYY-MM-DD date of birth. */
    dob: string | null;
    /** Biological sex. Keytel has separate coefficient sets for male/female. */
    sex: "male" | "female" | null;
    /** Latest known body weight in kg. Pulled from body_weights by the caller. */
    weight_kg: number | null;
  };
  /** Reference date for age calculation (YYYY-MM-DD). Usually the cardio session's user-day. */
  asOf: string;
};

export type CardioKcalEstimate = {
  /** Midpoint kcal value. Always a positive integer. */
  est_kcal_hr: number;
  /**
   * Which formula(s) contributed:
   *   - `keytel_and_mets` — both, midpoint averaging
   *   - `mets_only`       — profile fields missing for Keytel, METs only
   */
  basis: "keytel_and_mets" | "mets_only";
  /** Individual components, exposed for traceability / UI deltas. */
  components: {
    keytel_kcal: number | null;
    mets_kcal: number;
  };
};

/**
 * Sanity-check warning produced when the user's logged est_kcal disagrees
 * with the HR-derived estimate by more than `mismatchThresholdPct`. Returns
 * null when the deltas are within tolerance or when one of the inputs is
 * missing.
 */
export type CardioKcalWarning = {
  delta_pct: number;
  user_est_kcal: number;
  hr_est_kcal: number;
  message: string;
};

/** Whole years between dob and asOf, both YYYY-MM-DD. Returns null if dob is missing. */
function ageYears(dob: string | null, asOf: string): number | null {
  if (!dob) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${dob}T00:00:00Z`);
  return Math.floor((a - b) / (365.25 * 24 * 3600 * 1000));
}

/** Keytel (2005) per-minute kcal. Returns null when any input is missing. */
function keytelKcalPerMin(
  avg_hr: number,
  sex: "male" | "female" | null,
  weight_kg: number | null,
  age: number | null,
): number | null {
  if (sex === null || weight_kg === null || age === null) return null;
  // Coefficients straight from Keytel et al. 2005. The division by 4.184
  // converts kJ → kcal.
  const kj_per_min =
    sex === "male"
      ? -55.0969 + 0.6309 * avg_hr + 0.1988 * weight_kg + 0.2017 * age
      : -20.4022 + 0.4472 * avg_hr - 0.1263 * weight_kg + 0.074 * age;
  // Pathological inputs (very low HR, very low weight) can drive this
  // negative. Clamp at 0 — a negative per-minute burn is nonsensical.
  return Math.max(0, kj_per_min / 4.184);
}

/** METs formula: kcal = METs × 3.5 × weight_kg / 200 × min. */
function metsKcal(
  metsValue: number,
  weight_kg: number | null,
  duration_min: number,
  fallback_weight_kg: number,
): number {
  const w = weight_kg ?? fallback_weight_kg;
  return ((metsValue * 3.5 * w) / 200) * duration_min;
}

/**
 * Compute the HR-derived kcal estimate. Caller should only invoke this when
 * `avg_hr` and `duration_min` are both present (>0).
 */
export function computeCardioKcalEstimate(
  input: CardioKcalEstimateInput,
  config: CardioKcalConfig = DEFAULT_CARDIO_KCAL_CONFIG,
): CardioKcalEstimate {
  const age = ageYears(input.user.dob, input.asOf);
  const keytel = keytelKcalPerMin(input.avg_hr, input.user.sex, input.user.weight_kg, age);
  const keytel_kcal = keytel === null ? null : keytel * input.duration_min;
  const mets_kcal = metsKcal(
    config.defaultMets,
    input.user.weight_kg,
    input.duration_min,
    config.fallbackWeightKg,
  );

  if (keytel_kcal === null) {
    return {
      est_kcal_hr: Math.round(mets_kcal),
      basis: "mets_only",
      components: { keytel_kcal: null, mets_kcal: Math.round(mets_kcal) },
    };
  }

  const midpoint = (keytel_kcal + mets_kcal) / 2;
  return {
    est_kcal_hr: Math.round(midpoint),
    basis: "keytel_and_mets",
    components: {
      keytel_kcal: Math.round(keytel_kcal),
      mets_kcal: Math.round(mets_kcal),
    },
  };
}

/**
 * Compare the user-provided `est_kcal` to the HR-derived estimate. Returns
 * a structured warning when the deviation exceeds the configured threshold,
 * or null when within tolerance / inputs missing.
 *
 * Direction: positive `delta_pct` = user logged MORE than HR suggests
 * (potentially over-estimating burn), negative = user logged LESS.
 */
export function compareKcalEstimates(
  user_est_kcal: number | null | undefined,
  hr_est_kcal: number,
  config: CardioKcalConfig = DEFAULT_CARDIO_KCAL_CONFIG,
): CardioKcalWarning | null {
  if (user_est_kcal == null) return null;
  // Both must be positive to take a percentage. A zero HR estimate would
  // produce NaN/Infinity; a zero user estimate is degenerate (already
  // captured by the logging form's min(0)).
  if (hr_est_kcal <= 0) return null;
  const delta_pct = ((user_est_kcal - hr_est_kcal) / hr_est_kcal) * 100;
  if (Math.abs(delta_pct) < config.mismatchThresholdPct) return null;
  const direction = delta_pct > 0 ? "higher than" : "lower than";
  return {
    delta_pct: Number(delta_pct.toFixed(1)),
    user_est_kcal,
    hr_est_kcal,
    message: `Your logged ${user_est_kcal} kcal is ${Math.abs(delta_pct).toFixed(
      0,
    )}% ${direction} the HR-derived estimate of ${hr_est_kcal} kcal.`,
  };
}
