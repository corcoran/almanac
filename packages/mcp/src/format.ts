import { createHash } from "node:crypto";
import {
  formatAccomplishmentValue,
  kgToDisplayWeight,
  type UnitSystem,
  weightUnitLabel,
} from "@almanac/core/types";

type MealResponse = {
  id: number;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
};

export function summarizeMeal(
  meal: MealResponse,
  dayLabel: string,
  dayKcal: number,
  targetKcal: number,
): string {
  const pct = Math.round((dayKcal / targetKcal) * 100);
  return `Logged meal for ${dayLabel} — ${meal.kcal} kcal, ${meal.protein_g}p / ${meal.carb_g}c / ${meal.fat_g}f. ${dayLabel} total: ${dayKcal}/${targetKcal} (${pct}%).`;
}

/**
 * Canonical JSON: sorted keys, no whitespace. Stable across runs and across
 * payloads that differ only in key order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * Build an idempotency key by hashing the FULL normalized request payload.
 * Two POSTs that differ in any field — including macros, names, notes — yield
 * different keys and are NOT treated as duplicates. Spec §6.4.
 */
export function idempotencyKey(resource: string, userId: number, payload: unknown): string {
  const hash = createHash("sha256").update(canonicalJson(payload)).digest("hex");
  return `${resource}:${userId}:${hash}`;
}

type WorkoutResponseLite = {
  id: number;
  rpe: number;
  template_id: number | null;
  exercises?: Array<{ exercise_id: number; sets: Array<unknown>; skipped_at: string | null }>;
};
type CardioResponseLite = {
  id: number;
  modality: string | null;
  duration_min: number | null;
  est_kcal: number;
};
type SleepResponseLite = { id: number; hours: number; quality: number | null };
type AlcoholResponseLite = { id: number; drinks_count: number; est_kcal: number };
type WeightResponseLite = { id: number; weight_kg: number; measured_on: string };

export function summarizeWorkout(w: WorkoutResponseLite): string {
  const exs = w.exercises ?? [];
  if (w.template_id == null) {
    const n = exs.length;
    return `Logged workout — RPE ${w.rpe}, ${n} exercise${n === 1 ? "" : "s"}.`;
  }
  const skipped = exs.filter((e) => e.skipped_at != null).length;
  const done = exs.length - skipped;
  const skippedClause = skipped > 0 ? ` (${skipped} skipped)` : "";
  return `Logged workout — RPE ${w.rpe}, ${done}/${exs.length} exercises${skippedClause}.`;
}

export function summarizeCardio(c: CardioResponseLite): string {
  const parts: string[] = [];
  if (c.modality) parts.push(c.modality);
  if (c.duration_min) parts.push(`${c.duration_min}min`);
  parts.push(`${c.est_kcal} kcal`);
  return `Logged cardio — ${parts.join(", ")}.`;
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function weekdayShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

export function summarizeSleep(s: SleepResponseLite, sleptOn: string): string {
  // Echo BOTH the night-of date and the wake date so an off-by-one error in
  // either `slept_on` or `night_of` is visible at log time (Gaps 18, 30).
  const nightOf = dayBefore(sleptOn);
  const q = s.quality ? `, ${s.quality}/5` : "";
  return `Logged sleep — night of ${weekdayShort(nightOf)} ${nightOf} → woke ${weekdayShort(sleptOn)} ${sleptOn} — ${s.hours}h${q}.`;
}

type StepsResponseLite = {
  id: number;
  on_date: string;
  steps: number;
  est_kcal: number | null;
};

export function summarizeSteps(s: StepsResponseLite): string {
  const kcal = s.est_kcal != null ? ` (~${s.est_kcal} kcal)` : "";
  return `Logged steps — ${s.steps.toLocaleString("en-US")} on ${s.on_date}${kcal}.`;
}

export function summarizeAlcohol(a: AlcoholResponseLite): string {
  return `Logged drinks — ${a.drinks_count} std, ${a.est_kcal} kcal.`;
}

export function summarizeWeight(w: WeightResponseLite): string {
  return `Logged weight — ${w.weight_kg} kg on ${w.measured_on}.`;
}

export function summarizeAccomplishment(
  a: {
    code?: string;
    message: string;
    earned_on: string;
    prior_best: { earned_on: string; value: number } | null;
  },
  unitSystem: UnitSystem = "metric",
): string {
  if (a.prior_best === null) return `🎉 ${a.message}.`;
  // The headline `message` is already rendered in the user's unit by the API
  // (core's messageFor). Render the prior_best value consistently: weight-bearing
  // codes convert + get a unit label; everything else stays a bare number.
  const prior = formatAccomplishmentValue(a.code ?? "", a.prior_best.value, unitSystem);
  return `🎉 ${a.message} — your previous best was ${prior} (${a.prior_best.earned_on}).`;
}

type AccomplishmentAggregatesLite = {
  total: number;
  by_type: Record<string, number>;
  best_by_type: Record<string, { value: number; earned_on: string } | null>;
};

/**
 * One-line, LLM-facing summary of all-time accomplishment aggregates. Lists the
 * total and each meaningful personal best (omitting codes never earned).
 */
export function summarizeAccomplishmentAggregates(
  aggs: AccomplishmentAggregatesLite,
  unitSystem: UnitSystem = "metric",
): string {
  if (aggs.total === 0) return "No wins yet — keep logging.";
  const parts: string[] = [`${aggs.total} wins all-time`];
  const wis = aggs.best_by_type.weigh_in_streak;
  if (wis) parts.push(`longest weigh-in streak ${wis.value}d`);
  const wc = aggs.best_by_type.workout_consistency;
  if (wc) parts.push(`longest training streak ${wc.value}w`);
  const tas = aggs.best_by_type.target_adherence_streak;
  if (tas) parts.push(`longest adherence streak ${tas.value}d`);
  const wm = aggs.best_by_type.weight_milestone;
  if (wm)
    parts.push(
      `most down ${kgToDisplayWeight(wm.value, unitSystem)}${weightUnitLabel(unitSystem)}`,
    );
  if (aggs.by_type.tdee_measured && aggs.by_type.tdee_measured > 0) parts.push("TDEE measured");
  return `${parts.join("; ")}.`;
}

/**
 * Map an `observed.status` value to a short human-readable phrase suitable for
 * dropping into a summary line. Used by get_macros_today / get_macros_for_date /
 * get_day_status so the on/off/at-risk verdict from the TDEE refactor is
 * glanceable without the consumer having to read `observed.status` separately.
 *
 * The phrase set is intentionally tiny and identical across the three tools —
 * a shared vocabulary the AI consumer can rely on for adherence framing.
 */
export function statusPhrase(status: "on_track" | "at_risk" | "off_track"): string {
  switch (status) {
    case "on_track":
      return "on track";
    case "at_risk":
      return "at risk (close to maintenance)";
    case "off_track":
      return "off track";
  }
}
