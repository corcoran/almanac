/** Pure conversion: kg ↔ lb. 1 kg = 2.20462262 lb. */
const KG_TO_LB = 2.20462262;

export type UnitSystem = "metric" | "imperial";

// The accomplishment-value helpers (weight-code set + per-code formatter) live
// in core so the MCP summaries and the web share one source of truth. Re-export
// them here so web call sites keep importing from a single ./units module.
export { formatAccomplishmentValue, WEIGHT_VALUE_CODES } from "@almanac/core/types";

export function kgToDisplayWeight(kg: number | null, system: UnitSystem): number | null {
  if (kg === null) return null;
  return system === "imperial" ? round1(kg * KG_TO_LB) : kg;
}

export function displayWeightToKg(value: number, system: UnitSystem): number {
  return system === "imperial" ? value / KG_TO_LB : value;
}

export function weightUnitLabel(system: UnitSystem): string {
  return system === "imperial" ? "lb" : "kg";
}

const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

/** Split a height in cm into whole feet + inches (inches rounded). */
export function cmToFtIn(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return { feet: Math.floor(totalInches / INCHES_PER_FOOT), inches: totalInches % INCHES_PER_FOOT };
}

/** Combine feet + inches into cm (rounded to whole cm). */
export function ftInToCm(feet: number, inches: number): number {
  return Math.round((feet * INCHES_PER_FOOT + inches) * CM_PER_INCH);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
