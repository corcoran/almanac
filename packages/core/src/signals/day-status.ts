import type { Connection } from "../db/connection.js";
import { currentUserDate, userDayWindow } from "../domain/user-day.js";
import { getUntrackedDays } from "../repos/untracked-periods.repo.js";
import { findUserById } from "../repos/users.repo.js";
import { type DayStatusConfig, DEFAULT_DAY_STATUS_CONFIG } from "./config.js";
import type { DailyTargetStatus } from "./daily-target.js";
import { type EnergyBalance, getTodayContext } from "./today.js";

/**
 * Per-nudge severity. Three buckets — `info` (FYI, here's a thing),
 * `warn` (you should probably do something), and `concern` (this is a
 * pattern, worth a conversation). The AI consumer can use it to decide
 * whether to mention something proactively vs. surface it on request.
 */
export type NudgeSeverity = "info" | "warn" | "concern";

/**
 * Discriminated union of every nudge we currently emit. New nudge codes
 * go here so consumers can exhaustive-check.
 */
export type DayStatusNudge =
  | {
      code: "low_intake_today";
      severity: NudgeSeverity;
      message: string;
      details: { kcal_in: number; avg7d_kcal_in: number; fraction: number };
    }
  | {
      code: "no_workout_streak";
      severity: NudgeSeverity;
      message: string;
      details: { days_since_last: number };
    }
  | {
      code: "stale_weight_log";
      severity: NudgeSeverity;
      message: string;
      details: { days_since_last: number | null };
    }
  | {
      code: "stale_sleep_log";
      severity: NudgeSeverity;
      message: string;
      details: { days_since_last: number | null };
    }
  | {
      code: "unlogged_steps";
      severity: NudgeSeverity;
      message: string;
      details: { hour_local: number };
    };

export type DayStatus = {
  date: string;
  summary: {
    kcal_in: number;
    kcal_target: number;
    kcal_delta: number; // kcal_in - kcal_target. Negative = under target.
    protein_g_in: number;
    protein_g_target: number;
    energy_balance: EnergyBalance;
    workout_done: boolean;
    sleep_logged: boolean;
    weight_logged: boolean;
    alcohol_logged: boolean;
    meals_logged: boolean;
    steps_logged: boolean;
    status: DailyTargetStatus | null;
  };
  nudges: DayStatusNudge[];
};

/** YYYY-MM-DD → YYYY-MM-DD subtracted as whole days. */
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * True when EVERY day in the half-open range `(afterDate, throughDate]` is in
 * `untracked` — i.e. the entire staleness run is explained by marked untracked
 * periods. Used to suppress stale_weight_log / stale_sleep_log when the gap was
 * intentional. Returns false for an empty range (afterDate >= throughDate).
 */
function runFullyUntracked(
  afterDate: string,
  throughDate: string,
  untracked: Set<string>,
): boolean {
  if (afterDate >= throughDate) return false;
  for (let cursor = addDays(afterDate, 1); cursor <= throughDate; cursor = addDays(cursor, 1)) {
    if (!untracked.has(cursor)) return false;
  }
  return true;
}

/**
 * Compose a day-status payload: a glanceable summary of today + a list of
 * threshold-driven nudges (missing data, streaks, low intake). Wraps
 * `getTodayContext` so it inherits the same timezone/day-window handling.
 *
 * The nudges are intentionally NOT mixed into the summary fields — the AI
 * consumer decides whether to surface them. The summary is the always-on
 * "where are we today" snapshot.
 */
export function computeDayStatus(
  db: Connection,
  userId: number,
  now: Date = new Date(),
  config: DayStatusConfig = DEFAULT_DAY_STATUS_CONFIG,
): DayStatus {
  const user = findUserById(db, userId);
  if (!user) throw new Error(`user ${userId} not found`);
  const tz = user.timezone;
  const today = currentUserDate(now, tz);

  const ctx = getTodayContext(db, userId, now);

  // Untracked days for the staleness lookback — used to suppress stale_weight /
  // stale_sleep nudges when the entire run since the last log was intentionally
  // marked (vacation/sick/deload). See untracked-periods design. 90d matches the
  // untracked-periods list default and comfortably exceeds the >3x stale-nudge
  // "concern" threshold; a run older than this stays un-explained (nudge fires),
  // which is the safe direction.
  const staleUntracked = getUntrackedDays(db, userId, addDays(today, -90), today);

  // Summary block — derive from the already-composed TodayContext to avoid
  // re-querying. The "logged" booleans answer "did the user remember this
  // today", not "do they have data anywhere".
  //
  // No-active-phase case: ctx.today.target is null (new user, hasn't started a
  // phase yet). Rather than carry a nullable target through to the summary
  // shape, fall back to 0 — kcal_in is also 0 in this case for a brand-new
  // user, so kcal_delta == 0 and "no work to do here" is the honest answer.
  // The nudges below still fire normally (stale weight, no workout streak),
  // which is the genuinely actionable signal for a no-phase user.
  const kcal_target = ctx.today.target?.kcal ?? 0;
  const protein_g_target = ctx.today.target?.protein_g ?? 0;

  // Status is already computed as part of getTodayContext's DailyTargetOutput
  // when a phase is active. Extract it directly.
  const status: DailyTargetStatus | null = ctx.today.observed?.status ?? null;

  const summary = {
    kcal_in: ctx.today.kcal_in,
    kcal_target,
    kcal_delta: ctx.today.kcal_in - kcal_target,
    protein_g_in: ctx.today.protein_g_in,
    protein_g_target,
    energy_balance: ctx.today.energy_balance,
    workout_done: ctx.today.workouts.length > 0,
    sleep_logged: ctx.today.sleep !== null,
    weight_logged: ctx.today.body_weight_kg !== null,
    alcohol_logged: ctx.today.alcohol.length > 0,
    meals_logged: ctx.today.meals_logged_today,
    steps_logged: ctx.today.steps !== null,
    status,
  };

  const nudges: DayStatusNudge[] = [];

  // --- Nudge: low_intake_today ---------------------------------------------
  // Fires when today's kcal_in is below `lowIntakeFractionOfAvg` of the
  // trailing 7-day average. The baseline EXCLUDES today (so a low-intake
  // day doesn't pull down its own threshold). Skipped when the baseline is
  // 0 or has no data — first-time users shouldn't get a "low intake"
  // warning when there's nothing to compare against. Also skipped before
  // 14:00 user-local because morning kcal_in is naturally low and would
  // produce a noisy nudge before lunch.
  const yesterday = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const sevenDaysAgo = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  })();
  // Bucket meals into user-local days (DAY_START_HOUR + DST aware) rather than
  // SQLite's UTC date(eaten_at): an evening meal for an east-of-UTC user lands
  // on the next UTC date and would otherwise be misattributed (e.g. pulled out
  // of an untracked vacation day, or counted toward the wrong baseline day).
  // Pre-filter by a UTC range covering the window [sevenDaysAgo, yesterday]
  // user-local. The lower bound is padded one day west (windowStartUtc is the
  // user-local 4am boundary, which can sit on the previous UTC date) so an
  // east-of-UTC user's boundary rows aren't dropped; the upper bound is the end
  // of `yesterday`'s user-day. Over-included rows are bucketed and then dropped
  // by the user-local [sevenDaysAgo, yesterday] window restriction below.
  const windowStartUtc = userDayWindow(sevenDaysAgo, tz).startUtc.toISOString();
  const windowEndUtc = userDayWindow(yesterday, tz).endUtc.toISOString();
  const baselineMealRows = db
    .prepare(
      `SELECT eaten_at, kcal FROM meals
       WHERE user_id = ? AND eaten_at >= ? AND eaten_at < ?`,
    )
    .all(userId, windowStartUtc, windowEndUtc) as Array<{ eaten_at: string; kcal: number }>;
  const baselineByDay = new Map<string, { d: string; k: number }>();
  for (const m of baselineMealRows) {
    const d = currentUserDate(new Date(m.eaten_at), tz);
    // Restrict to the intended user-local window — replicates the old SQL
    // `date(eaten_at) BETWEEN sevenDaysAgo AND yesterday` day bound after
    // user-local bucketing, so the padded UTC pre-filter can't over-include.
    if (d < sevenDaysAgo || d > yesterday) continue;
    const cur = baselineByDay.get(d) ?? { d, k: 0 };
    cur.k += m.kcal;
    baselineByDay.set(d, cur);
  }
  const baselineRows = Array.from(baselineByDay.values());
  // Exclude untracked (vacation/sick/deload) days from the baseline — the
  // same exclusion TDEE applies. A vacation day where the user still logged
  // a light meal would otherwise drag the "usual" average down and make a
  // normal day read as low-intake. Days with no meals are already absent
  // from baselineRows; this also drops untracked days that DO have meals.
  const baselineUntracked = getUntrackedDays(db, userId, sevenDaysAgo, yesterday);
  const trackedRows = baselineRows.filter((r) => !baselineUntracked.has(r.d));
  const avg7d =
    trackedRows.length === 0 ? 0 : trackedRows.reduce((s, r) => s + r.k, 0) / trackedRows.length;
  const hourLocal = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: tz,
    }).format(now),
  );
  // Also gated on the user having logged ANY meals today. Without this,
  // a vacation/non-tracking day with avg7d > 0 fires the nudge every
  // afternoon — pure noise, since "didn't log" isn't the same as "ate
  // way less than usual".
  if (avg7d > 0 && hourLocal >= 14 && ctx.today.meals_logged_today) {
    const fraction = ctx.today.kcal_in / avg7d;
    if (fraction < config.lowIntakeFractionOfAvg) {
      nudges.push({
        code: "low_intake_today",
        severity: "warn",
        // Framed as a keep-logging prompt, not an error: a low logged total
        // in the afternoon usually means the day's meals aren't all entered
        // yet, not that the user genuinely ate far less than usual.
        message: `Logged ${Math.round(ctx.today.kcal_in)} kcal so far today, below your usual ~${Math.round(
          avg7d,
        )}. More meals to add?`,
        details: { kcal_in: ctx.today.kcal_in, avg7d_kcal_in: avg7d, fraction },
      });
    }
  }

  // --- Nudge: no_workout_streak --------------------------------------------
  // Look up the most recent workout. If there's nothing within
  // `noWorkoutMaxDays`, fire. "Workouts" = resistance training (the
  // `workouts` table); cardio sessions don't reset the counter because the
  // intent is "you stopped training", not "you stopped moving".
  //
  // NULL case: if the user has *never* logged a workout, we don't fire —
  // they may be using Almanac only for nutrition. The streak nudge is for
  // people who've trained before and lapsed.
  const lastWorkout = db
    .prepare(
      `SELECT started_at FROM workouts
       WHERE user_id = ? ORDER BY started_at DESC LIMIT 1`,
    )
    .get(userId) as { started_at: string } | undefined;
  if (lastWorkout) {
    // Bucket the last workout into the user-local day (DAY_START_HOUR + DST
    // aware) rather than SQLite's UTC date(started_at): an evening workout for
    // an east-of-UTC user is stored on the next UTC date and would otherwise
    // read as a day older than it actually is.
    const lastWorkoutDay = currentUserDate(new Date(lastWorkout.started_at), tz);
    const daysSince = daysBetween(lastWorkoutDay, today);
    if (daysSince >= config.noWorkoutMaxDays) {
      nudges.push({
        code: "no_workout_streak",
        severity: daysSince >= config.noWorkoutMaxDays * 2 ? "concern" : "warn",
        message: `No workout logged in ${daysSince} days. Last session: ${lastWorkoutDay}.`,
        details: { days_since_last: daysSince },
      });
    }
  }

  // --- Nudge: stale_weight_log ---------------------------------------------
  // Weight cadence affects TDEE confidence directly — a stale weight log
  // means TDEE drifts away from the truth. Fires when last weight is older
  // than `noWeightMaxDays`, OR when there's no weight log at all (severity
  // bumped to `concern` because the back-calc can't run without weight).
  const lastWeight = db
    .prepare(
      `SELECT measured_on AS d FROM body_weights
       WHERE user_id = ? ORDER BY measured_on DESC LIMIT 1`,
    )
    .get(userId) as { d: string } | undefined;
  if (!lastWeight) {
    nudges.push({
      code: "stale_weight_log",
      severity: "concern",
      message:
        "No weight has ever been logged. TDEE will stay at the profile-baseline estimate until weights start coming in.",
      details: { days_since_last: null },
    });
  } else {
    const daysSince = daysBetween(lastWeight.d, today);
    if (
      daysSince > config.noWeightMaxDays &&
      !runFullyUntracked(lastWeight.d, today, staleUntracked)
    ) {
      nudges.push({
        code: "stale_weight_log",
        severity: daysSince > config.noWeightMaxDays * 3 ? "concern" : "warn",
        message: `Last weigh-in was ${daysSince} days ago (${lastWeight.d}).`,
        details: { days_since_last: daysSince },
      });
    }
  }

  // --- Nudge: stale_sleep_log ----------------------------------------------
  // Mirror of stale_weight_log for sleep. Sleep debt math degrades when the
  // log is thin, but it's less critical than weight (no calibration story
  // attached), so severities are softer.
  const lastSleep = db
    .prepare(
      `SELECT slept_on AS d FROM sleep_logs
       WHERE user_id = ? ORDER BY slept_on DESC LIMIT 1`,
    )
    .get(userId) as { d: string } | undefined;
  if (!lastSleep) {
    nudges.push({
      code: "stale_sleep_log",
      severity: "info",
      message:
        "No sleep has ever been logged. Sleep debt won't be tracked until logs start coming in.",
      details: { days_since_last: null },
    });
  } else {
    const daysSince = daysBetween(lastSleep.d, today);
    if (
      daysSince > config.noSleepMaxDays &&
      !runFullyUntracked(lastSleep.d, today, staleUntracked)
    ) {
      nudges.push({
        code: "stale_sleep_log",
        severity: daysSince > config.noSleepMaxDays * 3 ? "warn" : "info",
        message: `Last sleep log was ${daysSince} days ago (${lastSleep.d}).`,
        details: { days_since_last: daysSince },
      });
    }
  }

  // --- Nudge: unlogged_steps -----------------------------------------------
  // Soft prompt to log today's steps. Fires when:
  //   - the active phase is a cut or bulk (maintenance doesn't need the precision),
  //   - no step log exists for today's user-day, AND
  //   - user-local time is past the configured threshold (default 20:00).
  //
  // Severity: info. The visible gap in the dashboard is the primary nudge;
  // this entry is the explicit prompt the LLM can surface verbatim. Cardio
  // and workouts are not factored in — this is purely about NEAT visibility.
  const phaseType = ctx.phase?.phase_type;
  if (
    (phaseType === "cut" || phaseType === "bulk") &&
    ctx.today.steps === null &&
    hourLocal >= config.unloggedStepsHourThreshold
  ) {
    nudges.push({
      code: "unlogged_steps",
      severity: "info",
      message: `No steps logged today yet (it's ${hourLocal}:00 local).`,
      details: { hour_local: hourLocal },
    });
  }

  return { date: today, summary, nudges };
}
