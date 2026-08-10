/**
 * Fallback average tokens per meal-chat log when the user has no recent history.
 * ~2000 from live data (input+output; Haiku). Used so a brand-new user still
 * gets a sensible "logs left" estimate.
 */
export const DEFAULT_AVG_TOKENS_PER_LOG = 2000;

/**
 * Per-feature fallback average tokens per log, used when a user has no recent
 * history for that surface. Meal-chat turns (~987 observed in prod) are far
 * cheaper than insights turns (~5130 — they embed the report briefing), so a
 * single default would make a brand-new insights user wildly over-optimistic or
 * a meal user pessimistic. The no-feature blended path still uses
 * DEFAULT_AVG_TOKENS_PER_LOG.
 */
export const DEFAULT_AVG_TOKENS_BY_FEATURE = {
  meal_chat: 1000,
  insights_chat: 5000,
} as const;

/**
 * The "logs left" count divides the remaining budget by a PADDED per-log cost so
 * it intentionally OVER-estimates token use — the count runs conservative (shows
 * fewer logs than the raw average implies). This means a user is less likely to
 * be surprised by running out, and the count is steadier near integer boundaries
 * (a multi-turn meal costs more than a one-shot, so a raw-average count can drop
 * by 2 in one step). Only the displayed count is affected — the real token meter,
 * the soft limit, and the hard cap are all computed from exact tokens.
 */
export const LOGS_LEFT_PADDING_FACTOR = 1.2;

export type ComputeDailyBalanceArgs = {
  tokensUsedToday: number;
  callsToday: number;
  recentAvgTokensPerCall: number | null;
  softLimitTokens: number | null;
  hardCapTokens: number | null;
  resetsAtLabel: string;
};

export type DailyBalance = {
  tokensUsed: number;
  callsToday: number;
  softLimit: number | null;
  hardCap: number | null;
  avgTokensPerLog: number;
  logsLeftEstimate: number | null;
  pctRemaining: number | null;
  hardLogsLeftEstimate: number | null;
  hardPctRemaining: number | null;
  overSoftLimit: boolean;
  overHardCap: boolean;
  resetsAt: string;
};

/**
 * Remaining-budget figures for ONE tier. Both tiers report the same shape so the
 * client can warn on either without knowing which is which.
 *
 * A null or non-positive limit means the tier isn't configured, and both figures
 * come back null rather than 0 — a missing tier must not render as "exhausted".
 * The `limit === null` branch also narrows without `!` (lint-blocked).
 */
function tierRemaining(
  limitTokens: number | null,
  usedTokens: number,
  avgTokensPerLog: number,
): { logsLeft: number | null; pctRemaining: number | null } {
  if (limitTokens === null || limitTokens <= 0) return { logsLeft: null, pctRemaining: null };
  const remainingTokens = Math.max(0, limitTokens - usedTokens);
  // Divide by a PADDED per-log cost so the count over-estimates token use and
  // runs conservative. The reported `avgTokensPerLog` stays the RAW average
  // (the detail line should show real usage, not the padded figure).
  const paddedAvg = avgTokensPerLog * LOGS_LEFT_PADDING_FACTOR;
  return {
    logsLeft: Math.floor(remainingTokens / paddedAvg),
    pctRemaining: Math.max(0, Math.round((remainingTokens / limitTokens) * 100)),
  };
}

export function computeDailyBalance(args: ComputeDailyBalanceArgs): DailyBalance {
  const avgTokensPerLog =
    args.recentAvgTokensPerCall && args.recentAvgTokensPerCall > 0
      ? args.recentAvgTokensPerCall
      : DEFAULT_AVG_TOKENS_PER_LOG;

  const soft = args.softLimitTokens;
  const hard = args.hardCapTokens;
  const softFigures = tierRemaining(soft, args.tokensUsedToday, avgTokensPerLog);
  const hardFigures = tierRemaining(hard, args.tokensUsedToday, avgTokensPerLog);

  return {
    tokensUsed: args.tokensUsedToday,
    callsToday: args.callsToday,
    softLimit: soft !== null && soft > 0 ? soft : null,
    hardCap: hard,
    avgTokensPerLog,
    logsLeftEstimate: softFigures.logsLeft,
    pctRemaining: softFigures.pctRemaining,
    hardLogsLeftEstimate: hardFigures.logsLeft,
    hardPctRemaining: hardFigures.pctRemaining,
    overSoftLimit: soft !== null && soft > 0 ? args.tokensUsedToday > soft : false,
    overHardCap: hard !== null ? args.tokensUsedToday >= hard : false,
    resetsAt: args.resetsAtLabel,
  };
}
