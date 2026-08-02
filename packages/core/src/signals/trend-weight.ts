import { last, requireNonEmpty } from "./array.js";
import { DEFAULT_TREND_WEIGHT_CONFIG, type TrendWeightConfig } from "./config.js";

export type TrendWeightPoint = {
  date: string; // YYYY-MM-DD
  raw_kg: number | null;
  trend_kg: number;
};

type Reading = { measured_on: string; weight_kg: number };

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type WeightChange = {
  value_kg: number;
  over_days: number;
  confidence: "early" | "established";
};

/**
 * Headline body-weight change for the user's most recent 30-day window.
 *
 * Design: "helpful early beats honestly empty." With as few as two readings,
 * we return the raw first→last delta and tag confidence as `early`; once the
 * window spans the full 30 days we tag it `established`. Returning a
 * meaningful value with a confidence tag lets callers reason about progress
 * without waiting a month for a "real" answer.
 *
 * Window: ends at the most recent reading's date and extends 30 days back.
 * Readings outside that window are ignored so a months-old log doesn't
 * dominate the comparison.
 *
 * Returns null only when fewer than two readings fall inside the window —
 * there's literally no change to report.
 */
export function computeWeightChange(readings: Reading[]): WeightChange | null {
  if (readings.length < 2) return null;
  const sorted = requireNonEmpty(
    [...readings].sort((a, b) => (a.measured_on < b.measured_on ? -1 : 1)),
    "computeWeightChange readings",
  );
  const lastReading = last(sorted);
  const windowStartIso = addDays(lastReading.measured_on, -30);
  const inWindow = sorted.filter((r) => r.measured_on >= windowStartIso);
  const firstReading = inWindow[0];
  if (firstReading === undefined || inWindow.length < 2) return null;
  const days = Math.round(
    (new Date(`${lastReading.measured_on}T00:00:00Z`).getTime() -
      new Date(`${firstReading.measured_on}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  return {
    value_kg: Math.round((lastReading.weight_kg - firstReading.weight_kg) * 100) / 100,
    over_days: days,
    confidence: days >= 30 ? "established" : "early",
  };
}

export function computeTrendWeight(
  readings: Reading[],
  config: TrendWeightConfig = DEFAULT_TREND_WEIGHT_CONFIG,
): TrendWeightPoint[] {
  if (readings.length === 0) return [];
  const sorted = requireNonEmpty(
    [...readings].sort((a, b) => (a.measured_on < b.measured_on ? -1 : 1)),
    "computeTrendWeight readings",
  );
  const firstReading = sorted[0];
  const lastReading = last(sorted);
  const alpha = 1 - 0.5 ** (1 / config.halfLifeDays);
  const byDate = new Map(sorted.map((r) => [r.measured_on, r.weight_kg]));

  const out: TrendWeightPoint[] = [];
  let trend = firstReading.weight_kg;
  let cursor = firstReading.measured_on;
  while (cursor <= lastReading.measured_on) {
    const raw = byDate.get(cursor);
    if (raw !== undefined) {
      trend = alpha * raw + (1 - alpha) * trend;
      out.push({ date: cursor, raw_kg: raw, trend_kg: trend });
    } else {
      out.push({ date: cursor, raw_kg: null, trend_kg: trend });
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}
