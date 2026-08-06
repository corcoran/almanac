import type { Connection } from "../db/connection.js";
import { currentUserDate } from "../domain/user-day.js";
import { listBodyWeights } from "../repos/body-weights.repo.js";
import { findActivePhase } from "../repos/nutrition-phases.repo.js";
import { listSleepLogs } from "../repos/sleep.repo.js";
import { findStepLogByDate } from "../repos/step-logs.repo.js";
import { getUntrackedDays } from "../repos/untracked-periods.repo.js";
import { findUserById } from "../repos/users.repo.js";
import { listTemplates } from "../repos/workout-templates.repo.js";
import { computeDayStatus, type DayStatusNudge, type NudgeSeverity } from "./day-status.js";

/** Which tier an action came from. Lets clients weight proactivity. */
export type NextBestActionTier = "onboarding" | "previous_day" | "today";

/** Stable action codes. LLM clients branch on these. */
export type NextBestActionCode =
  // Tier 1 — onboarding
  | "complete_profile"
  | "log_initial_weight"
  | "start_nutrition_phase"
  | "create_workout_templates"
  // Tier 2 — previous-day completeness
  | "log_yesterday_sleep"
  | "log_yesterday_steps"
  // Tier 3 — passthrough day-status nudge codes
  | "low_intake_today"
  | "no_workout_streak"
  | "stale_weight_log"
  | "stale_sleep_log"
  | "unlogged_steps";

export type NextBestAction = {
  code: NextBestActionCode;
  tier: NextBestActionTier;
  title: string;
  detail: string;
  /** The tool the LLM should consider calling. */
  suggested_tool: string;
  /** Optional, possibly-partial arg hint. Never authoritative. */
  suggested_args?: Record<string, unknown>;
  /** Present only on `today`-tier actions: the originating day-status nudge severity. */
  severity?: NudgeSeverity;
  /** Present only on `today`-tier actions: the originating day-status nudge structured details. */
  details?: Record<string, unknown>;
};

export type NextBestActionResult = {
  /** User-local date the evaluation ran for. */
  as_of: string;
  /** True when every Tier-1 onboarding gate has passed. */
  onboarding_complete: boolean;
  /** The single top action, or null when all_clear. */
  headline: NextBestAction | null;
  /** Full ranked list, headline first. Empty when all_clear. */
  actions: NextBestAction[];
  /** True when nothing fired across all tiers. */
  all_clear: boolean;
};

/** YYYY-MM-DD one day before `isoDate`, via UTC-midnight subtraction. */
function previousDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Map a day-status nudge code to the tool that resolves it. */
function suggestedToolForNudge(code: DayStatusNudge["code"]): string {
  switch (code) {
    case "low_intake_today":
      return "log_meal";
    case "no_workout_streak":
      return "log_workout";
    case "stale_weight_log":
      return "log_weight";
    case "stale_sleep_log":
      return "log_sleep";
    // unlogged_steps is info-only in day-status today (never passes the warn/concern
    // Tier-3 filter); mapped here for forward-compat if its severity ever escalates.
    case "unlogged_steps":
      return "log_steps";
    default:
      return "get_day_status";
  }
}

/**
 * Compute the user's single highest-priority next action plus the full ranked
 * list. Three tiers, evaluated in order: onboarding gates (Tier 1), yesterday's
 * forgotten sleep/steps (Tier 2), today's gaps delegated to day-status nudges
 * (Tier 3). The first tier that produces actions sets the headline.
 *
 * Pure read — no writes. Mirrors the (db, userId, now) shape of the other
 * signals so the route stays a one-liner.
 */
export function computeNextBestAction(
  db: Connection,
  userId: number,
  now: Date = new Date(),
): NextBestActionResult {
  const user = findUserById(db, userId);
  if (!user) throw new Error(`user ${userId} not found`);
  const today = currentUserDate(now, user.timezone);

  // --- Tier 1: onboarding gates (dependency order) ------------------------
  const onboarding: NextBestAction[] = [];

  const profileIncomplete =
    user.dob === null ||
    user.height_cm === null ||
    user.sex === null ||
    user.activity_level === null;
  if (profileIncomplete) {
    onboarding.push({
      code: "complete_profile",
      tier: "onboarding",
      title: "Complete your profile",
      detail:
        "Confirm timezone, date of birth, height, sex, preferred units, and activity level. Date of birth, height, and sex drive the BMR baseline; activity level scales it and is the largest single lever on the starting estimate.",
      suggested_tool: "update_user_profile",
    });
  }

  const hasWeight = listBodyWeights(db, userId, { limit: 1 }).length > 0;
  if (!hasWeight) {
    onboarding.push({
      code: "log_initial_weight",
      tier: "onboarding",
      title: "Log an initial weight",
      detail:
        "A first weigh-in lets TDEE move off the formula-only baseline. Confidence climbs over ~14 days of weigh-ins.",
      suggested_tool: "log_weight",
    });
  }

  const phase = findActivePhase(db, userId);
  if (!phase) {
    onboarding.push({
      code: "start_nutrition_phase",
      tier: "onboarding",
      title: "Start a nutrition phase",
      detail:
        "No active phase. If no goal is stated, start a provisional maintenance phase off the formula-based TDEE estimate — it recalibrates as food and weight data accumulate.",
      suggested_tool: "start_nutrition_phase",
      suggested_args: { phase_type: "maintenance" },
    });
  }

  const hasTemplates = listTemplates(db, userId).length > 0;
  if (!hasTemplates) {
    onboarding.push({
      code: "create_workout_templates",
      tier: "onboarding",
      title: "Set up workout templates",
      detail:
        "Ask about the user's training routine (e.g. a PPL or upper/lower split), then create workout templates so log_workout can hydrate from them.",
      suggested_tool: "define_workout_template",
    });
  }

  const onboardingHeadline = onboarding[0];

  if (onboardingHeadline !== undefined) {
    return {
      as_of: today,
      onboarding_complete: false,
      headline: onboardingHeadline,
      actions: onboarding,
      all_clear: false,
    };
  }

  // --- Tier 2: previous-day completeness (yesterday only) -----------------
  // Yesterday is over, so its holes never surface as "today incomplete".
  // Only sleep + steps: the two truly-daily, easy-to-forget logs.
  const yesterday = previousDay(today);
  const previousDayActions: NextBestAction[] = [];

  // A marked untracked period over yesterday means the missing sleep/steps
  // logs are intentional, not forgotten — don't nag to backfill them.
  const yesterdayUntracked = getUntrackedDays(db, userId, yesterday, yesterday).has(yesterday);

  const yesterdaySleep = listSleepLogs(db, userId, {
    from: yesterday,
    to: today,
    limit: 1,
  });
  if (yesterdaySleep.length === 0 && !yesterdayUntracked) {
    previousDayActions.push({
      code: "log_yesterday_sleep",
      tier: "previous_day",
      title: "Log last night's sleep",
      detail: `No sleep log for ${yesterday}. Easy to forget once the day gets going — log it before the data is gone.`,
      suggested_tool: "log_sleep",
      suggested_args: { slept_on: yesterday },
    });
  }

  const yesterdaySteps = findStepLogByDate(db, userId, yesterday);
  if (yesterdaySteps === null && !yesterdayUntracked) {
    previousDayActions.push({
      code: "log_yesterday_steps",
      tier: "previous_day",
      title: "Log yesterday's steps",
      detail: `No step count for ${yesterday}. A missed day is a permanent hole in NEAT/TDEE adherence.`,
      suggested_tool: "log_steps",
      suggested_args: { on_date: yesterday },
    });
  }

  const previousDayHeadline = previousDayActions[0];
  if (previousDayHeadline !== undefined) {
    return {
      as_of: today,
      onboarding_complete: true,
      headline: previousDayHeadline,
      actions: previousDayActions,
      all_clear: false,
    };
  }

  // --- Tier 3: today's gaps (delegated to day-status nudges) --------------
  // Single source of truth: reuse computeDayStatus rather than recomputing
  // streak/staleness logic. Only warn + concern bubble up as actions; info
  // nudges stay informational (surfaced by get_day_status on request).
  const dayStatus = computeDayStatus(db, userId, now);
  const todayActions: NextBestAction[] = dayStatus.nudges
    .filter((n) => n.severity === "warn" || n.severity === "concern")
    .map((n) => ({
      code: n.code,
      tier: "today" as const,
      title: n.message,
      detail: n.message,
      suggested_tool: suggestedToolForNudge(n.code),
      severity: n.severity,
      details: n.details as Record<string, unknown>,
    }));

  const todayHeadline = todayActions[0];
  if (todayHeadline !== undefined) {
    return {
      as_of: today,
      onboarding_complete: true,
      headline: todayHeadline,
      actions: todayActions,
      all_clear: false,
    };
  }

  return {
    as_of: today,
    onboarding_complete: true,
    headline: null,
    actions: [],
    all_clear: true,
  };
}
