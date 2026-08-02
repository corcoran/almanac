import type { Connection } from "../db/connection.js";
import { addDaysIso, currentUserDate } from "../domain/user-day.js";
import { listExercises } from "../repos/exercises.repo.js";
import { listTemplates } from "../repos/workout-templates.repo.js";
import { listWorkoutsWithDetail } from "../repos/workouts.repo.js";

const RPE_TREND_THRESHOLD = 0.5;
const MIN_SESSIONS_FOR_TREND = 3;
const DEVIATION_NOTABLE_RATE = 0.4;
const LOAD_THRESHOLD_KG = 2.5;
const LOAD_PROGRESSION_CAP = 5;

function deviationStats(
  sessions: { exercises?: { exercise_id: number; skipped_at: string | null }[] }[],
  exerciseName: Map<number, string>,
): { rate: number; notable: string | null } {
  let deviated = 0;
  const skipCounts = new Map<number, number>();
  for (const w of sessions) {
    const skips = (w.exercises ?? []).filter((ei) => ei.skipped_at != null);
    if (skips.length > 0) deviated += 1;
    for (const s of skips) {
      skipCounts.set(s.exercise_id, (skipCounts.get(s.exercise_id) ?? 0) + 1);
    }
  }
  const rate = sessions.length > 0 ? deviated / sessions.length : 0;
  let notable: string | null = null;
  if (rate >= DEVIATION_NOTABLE_RATE && skipCounts.size > 0) {
    const top = [...skipCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top !== undefined) {
      notable = `skipped ${exerciseName.get(top[0]) ?? "an exercise"} in ${top[1]} of ${sessions.length} sessions`;
    }
  }
  return { rate: Math.round(rate * 100) / 100, notable };
}

function loadProgression(
  workouts: {
    started_at: string;
    exercises?: { exercise_id: number; sets?: { weight_kg: number | null }[] }[];
  }[],
  exerciseName: Map<number, string>,
): LoadProgress[] {
  const byEx = new Map<number, { date: string; topKg: number }[]>();
  for (const w of workouts) {
    for (const ei of w.exercises ?? []) {
      const weights = (ei.sets ?? [])
        .map((s) => s.weight_kg)
        .filter((x): x is number => typeof x === "number");
      if (weights.length === 0) continue;
      const topKg = Math.max(...weights);
      const arr = byEx.get(ei.exercise_id) ?? [];
      arr.push({ date: w.started_at, topKg });
      byEx.set(ei.exercise_id, arr);
    }
  }
  const entries = [...byEx.entries()]
    .filter(([, pts]) => pts.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, LOAD_PROGRESSION_CAP);
  const out: LoadProgress[] = [];
  for (const [exId, pts] of entries) {
    const sorted = [...pts].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first === undefined || last === undefined) continue;
    const delta = last.topKg - first.topKg;
    const direction: LoadDirection =
      delta >= LOAD_THRESHOLD_KG
        ? "climbing"
        : delta <= -LOAD_THRESHOLD_KG
          ? "dropping"
          : "stalled";
    out.push({
      exercise_name: exerciseName.get(exId) ?? `exercise ${exId}`,
      direction,
      from_kg: first.topKg,
      to_kg: last.topKg,
    });
  }
  return out;
}

function rpeTrend(sortedAscSessions: { rpe: number }[]): RpeTrend {
  const rpes = sortedAscSessions
    .map((w) => w.rpe)
    .filter((r): r is number => typeof r === "number" && r > 0);
  if (rpes.length < MIN_SESSIONS_FOR_TREND) return null;
  const mid = Math.floor(rpes.length / 2);
  const earlier = rpes.slice(0, mid);
  const recent = rpes.slice(rpes.length - mid);
  const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const delta = mean(recent) - mean(earlier);
  if (delta >= RPE_TREND_THRESHOLD) return "up";
  if (delta <= -RPE_TREND_THRESHOLD) return "down";
  return "steady";
}

function frequencyNote(by_split: SplitSummary[]): string | null {
  if (by_split.length < 2) return null;
  const sorted = [...by_split].sort((a, b) => a.sessions - b.sessions);
  const least = sorted[0];
  const most = sorted[sorted.length - 1];
  if (least === undefined || most === undefined) return null;
  if (most.sessions >= least.sessions * 2 && most.sessions - least.sessions >= 2) {
    return `${most.template_name} ${most.sessions}x / ${least.template_name} ${least.sessions}x — ${least.template_name} undertrained this block`;
  }
  return null;
}

export type RpeTrend = "up" | "down" | "steady" | null;
export type LoadDirection = "climbing" | "stalled" | "dropping";

export type SplitSummary = {
  template_name: string;
  sessions: number;
  last_trained: string;
  avg_rpe: number | null;
  rpe_vs_baseline: RpeTrend;
  deviation_rate: number;
  notable_deviation: string | null;
};

export type LoadProgress = {
  exercise_name: string;
  direction: LoadDirection;
  from_kg: number;
  to_kg: number;
};

export type TrainingHistorySummary = {
  window_days: number;
  sessions: number;
  by_split: SplitSummary[];
  load_progression: LoadProgress[];
  frequency_note: string | null;
};

export function summarizeTrainingHistory(
  db: Connection,
  userId: number,
  now: Date,
  tz: string,
  opts: { days: number },
): TrainingHistorySummary {
  // The user-local "today" anchors the window and per-session day attribution.
  // `last_trained` is a day surfaced to the user, so it must be user-local (a
  // 9pm-EDT workout is "today" for the user, not tomorrow's UTC date).
  const today = currentUserDate(now, tz);
  const from = addDaysIso(today, -(opts.days - 1));

  const workouts = listWorkoutsWithDetail(db, userId, {
    from: `${from}T00:00:00Z`,
    to: `${addDaysIso(today, 1)}T00:00:00Z`,
    limit: 200,
  });

  if (workouts.length === 0) {
    return {
      window_days: opts.days,
      sessions: 0,
      by_split: [],
      load_progression: [],
      frequency_note: null,
    };
  }

  const templates = listTemplates(db, userId, { includeArchived: false });
  const templateName = new Map(templates.map((t) => [t.id, t.name]));

  const exercises = listExercises(db, userId, { includeArchived: true });
  const exerciseName = new Map(exercises.map((e) => [e.id, e.name]));

  const groups = new Map<string, typeof workouts>();
  for (const w of workouts) {
    const name =
      w.template_id != null ? (templateName.get(w.template_id) ?? "Unlabeled") : "Unlabeled";
    const arr = groups.get(name) ?? [];
    arr.push(w);
    groups.set(name, arr);
  }

  const by_split: SplitSummary[] = [...groups.entries()].map(([name, sessions]) => {
    const sorted = [...sessions].sort((a, b) => a.started_at.localeCompare(b.started_at));
    const last = sorted[sorted.length - 1];
    const rpes = sorted
      .map((w) => w.rpe)
      .filter((r): r is number => typeof r === "number" && r > 0);
    const avg_rpe = rpes.length > 0 ? rpes.reduce((s, r) => s + r, 0) / rpes.length : null;
    const dev = deviationStats(sorted, exerciseName);
    return {
      template_name: name,
      sessions: sorted.length,
      last_trained: last !== undefined ? currentUserDate(new Date(last.started_at), tz) : today,
      avg_rpe: avg_rpe !== null ? Math.round(avg_rpe * 10) / 10 : null,
      rpe_vs_baseline: rpeTrend(sorted),
      deviation_rate: dev.rate,
      notable_deviation: dev.notable,
    };
  });

  return {
    window_days: opts.days,
    sessions: workouts.length,
    by_split,
    load_progression: loadProgression(workouts, exerciseName),
    frequency_note: frequencyNote(by_split),
  };
}
