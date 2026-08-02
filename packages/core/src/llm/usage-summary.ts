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
  avgTokensPerLog: number;
  logsLeftEstimate: number | null;
  pctRemaining: number | null;
  overSoftLimit: boolean;
  overHardCap: boolean;
  resetsAt: string;
};

export function computeDailyBalance(args: ComputeDailyBalanceArgs): DailyBalance {
  const avgTokensPerLog =
    args.recentAvgTokensPerCall && args.recentAvgTokensPerCall > 0
      ? args.recentAvgTokensPerCall
      : DEFAULT_AVG_TOKENS_PER_LOG;

  // Narrow softLimitTokens once via an explicit branch so the soft-limit math
  // sees a non-null `soft` without any `!` (lint-blocked) or cast.
  const soft = args.softLimitTokens;
  let softLimit: number | null = null;
  let logsLeftEstimate: number | null = null;
  let pctRemaining: number | null = null;
  let overSoftLimit = false;
  if (soft !== null && soft > 0) {
    softLimit = soft;
    const remainingTokens = Math.max(0, soft - args.tokensUsedToday);
    // Divide by a PADDED per-log cost so the count over-estimates token use and
    // runs conservative. The reported `avgTokensPerLog` stays the RAW average
    // (the detail line should show real usage, not the padded figure).
    const paddedAvg = avgTokensPerLog * LOGS_LEFT_PADDING_FACTOR;
    logsLeftEstimate = Math.floor(remainingTokens / paddedAvg);
    pctRemaining = Math.max(0, Math.round((remainingTokens / soft) * 100));
    overSoftLimit = args.tokensUsedToday > soft;
  }

  const overHardCap =
    args.hardCapTokens !== null ? args.tokensUsedToday >= args.hardCapTokens : false;

  return {
    tokensUsed: args.tokensUsedToday,
    callsToday: args.callsToday,
    softLimit,
    avgTokensPerLog,
    logsLeftEstimate,
    pctRemaining,
    overSoftLimit,
    overHardCap,
    resetsAt: args.resetsAtLabel,
  };
}
