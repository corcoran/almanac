import { addDaysIso } from "@almanac/core/types";

/**
 * Pure geometry for the steps chart (used by StepsBlock). One bar per day in
 * `windowDates`; unlogged days are ghost slots. Bars scale to the busiest
 * logged day in the window, since there's no step goal to scale against.
 */

const STEPS_CHART_DAYS = 14;

export type StepsDay = { on_date: string; steps: number };

export type StepsBar =
  | { on_date: string; logged: true; steps: number; heightPct: number; isTarget: boolean }
  | { on_date: string; logged: false; steps: null; heightPct: 0; isTarget: boolean };

/** The 14 days the chart renders, oldest first, ending at the steps target day. */
export function stepsWindowDates(targetOn: string): string[] {
  return Array.from({ length: STEPS_CHART_DAYS }, (_, i) =>
    addDaysIso(targetOn, i - (STEPS_CHART_DAYS - 1)),
  );
}

/** The chart's days plus the step-logs range that fetches them (`to` is exclusive). */
export function stepsChartRange(targetOn: string): { from: string; to: string; dates: string[] } {
  return {
    from: addDaysIso(targetOn, -(STEPS_CHART_DAYS - 1)),
    to: addDaysIso(targetOn, 1),
    dates: stepsWindowDates(targetOn),
  };
}

export function stepsBarGeometry(
  logs: StepsDay[],
  windowDates: string[],
  targetOn: string,
): StepsBar[] {
  const byDate = new Map(logs.map((l) => [l.on_date, l.steps]));
  const inWindow = windowDates
    .map((d) => byDate.get(d))
    .filter((n): n is number => n !== undefined);
  const max = Math.max(0, ...inWindow);
  return windowDates.map((on_date) => {
    const steps = byDate.get(on_date);
    const isTarget = on_date === targetOn;
    if (steps === undefined) return { on_date, logged: false, steps: null, heightPct: 0, isTarget };
    const heightPct = max > 0 ? Math.round((steps / max) * 100) : 0;
    return { on_date, logged: true, steps, heightPct, isTarget };
  });
}

/** Mean of the logged days inside the window, or null when none are logged. */
export function stepsAverage(logs: StepsDay[], windowDates: string[]): number | null {
  const window = new Set(windowDates);
  const counts = logs.filter((l) => window.has(l.on_date)).map((l) => l.steps);
  if (counts.length === 0) return null;
  return Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
}

/** Compact bar label: "850", "9.4k", "15k". */
export function formatStepsShort(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k >= 9.95) return `${Math.round(k)}k`;
  const oneDp = k.toFixed(1);
  return `${oneDp.endsWith(".0") ? oneDp.slice(0, -2) : oneDp}k`;
}
