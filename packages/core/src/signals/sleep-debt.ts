import { DEFAULT_SLEEP_CONFIG, type SleepConfig } from "./config.js";

export type SleepDebt = {
  debt_hours: number;
  window_days: number;
  baseline_hours: number;
  avg_hours: number;
  nights_logged: number;
};

type SleepReading = { slept_on: string; hours: number };

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function computeSleepDebt(
  logs: SleepReading[],
  asOf: string,
  config: SleepConfig = DEFAULT_SLEEP_CONFIG,
  untrackedDays: ReadonlySet<string> = new Set(),
): SleepDebt {
  const start = addDays(asOf, -(config.windowDays - 1));
  // Drop nights inside an untracked (vacation/sick/deload) period: a short
  // vacation night shouldn't inflate debt or pull the average down, since the
  // user wasn't tracking normally then.
  const inWindow = logs.filter(
    (l) => l.slept_on >= start && l.slept_on <= asOf && !untrackedDays.has(l.slept_on),
  );
  let debt = 0;
  let total = 0;
  for (const l of inWindow) {
    total += l.hours;
    if (l.hours < config.baselineHours) debt += config.baselineHours - l.hours;
  }
  return {
    debt_hours: debt,
    window_days: config.windowDays,
    baseline_hours: config.baselineHours,
    avg_hours: inWindow.length ? total / inWindow.length : 0,
    nights_logged: inWindow.length,
  };
}
