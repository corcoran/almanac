import type { UnitSystem } from "./users.js";

/**
 * Weight unit conversion for *display*. Persisted weights are always kg (see
 * `mcp/capabilities.ts`: "All persisted weights are in kg … convert at the UI
 * layer"). This helper converts kg → the user's preferred display unit for prose
 * that core builds itself — currently the accomplishment messages, whose raw
 * `value` field stays kg by contract.
 *
 * Mirrors `packages/web/src/lib/units.ts` (same factor, same 1-dp rounding) so
 * the web display layer and core-built messages never drift.
 */
const KG_TO_LB = 2.20462262;

/** Convert kg to the user's display unit, rounded to 1 decimal place. */
export function kgToDisplayWeight(kg: number, system: UnitSystem): number {
  return system === "imperial" ? round1(kg * KG_TO_LB) : kg;
}

/** The short unit label for the user's display system. */
export function weightUnitLabel(system: UnitSystem): string {
  return system === "imperial" ? "lb" : "kg";
}

/**
 * Accomplishment codes whose numeric `value` (and `prior_best.value` /
 * best_by_type value) is a weight in kg. Their `message` text converts in
 * `signals/accomplishments.ts` messageFor; this set lets the display layers
 * (web + MCP summaries) also convert the raw value fields they render directly.
 * Must stay in sync with the weight-bearing cases in messageFor.
 */
export const WEIGHT_VALUE_CODES: ReadonlySet<string> = new Set([
  "weight_milestone",
  "strength_pr",
  "phase_complete",
  "volume_total",
]);

/**
 * Display value for a strength-PR estimated 1RM (e1RM): the Epley estimate is
 * an approximation, so we floor it to the nearest 5 in the user's display unit
 * rather than showing false-precision decimals (e.g. 62.8 lb → 60 lb). Floor,
 * not nearest — the e1RM is an extrapolation, so "at least N" never overstates
 * what the lifter demonstrably hit. Display-only; the canonical `value` stays
 * the precise e1RM in kg.
 */
export function displayE1rm(kg: number, system: UnitSystem): number {
  const display = kgToDisplayWeight(kg, system);
  return Math.floor(display / 5) * 5;
}

/**
 * Format a raw kg `value` for an accomplishment code into a display string.
 * Weight-bearing codes convert + get a unit label; all other codes (streaks,
 * counts, days) render the bare value unchanged. `strength_pr` is the lone
 * exception that floors to the nearest 5 (see `displayE1rm`) — the other
 * weight codes keep 1-dp precision.
 */
export function formatAccomplishmentValue(code: string, value: number, system: UnitSystem): string {
  if (!WEIGHT_VALUE_CODES.has(code)) return String(value);
  if (code === "strength_pr") {
    return `${displayE1rm(value, system)} ${weightUnitLabel(system)}`;
  }
  return `${kgToDisplayWeight(value, system)} ${weightUnitLabel(system)}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
