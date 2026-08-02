import type { Connection } from "../db/connection.js";
import { userDayWindow } from "../domain/user-day.js";
import { computeCostUsd, type TokenCounts } from "./pricing.js";

export type RecordUsageInput = {
  userId: number;
  createdAt: string; // ISO-UTC
  provider: string;
  model: string;
  feature: string; // 'meal_chat'
  usage: TokenCounts;
  webSearchRequests: number;
  billedTokens: number;
};

/** Insert one usage row, freezing cost_usd from the price table at write time. */
export function recordLlmUsage(db: Connection, input: RecordUsageInput): void {
  const cost = computeCostUsd(input.provider, input.model, input.usage);
  db.prepare(
    `INSERT INTO llm_usage
       (user_id, created_at, provider, model, feature,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd,
        web_search_requests, billed_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.userId,
    input.createdAt,
    input.provider,
    input.model,
    input.feature,
    input.usage.input_tokens,
    input.usage.output_tokens,
    input.usage.cache_read_tokens,
    input.usage.cache_creation_tokens,
    cost,
    input.webSearchRequests,
    input.billedTokens,
  );
}

export type DayUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  billed_tokens: number;
  cost_usd: number;
  calls: number;
};

/**
 * Sum a user's usage for one user-local day (4am rollover, tz-aware). Queries
 * the UTC range from userDayWindow rather than date(created_at), which truncates
 * in UTC and mis-attributes evening events for non-UTC users.
 */
export function getUsageForDay(db: Connection, userId: number, tz: string, date: string): DayUsage {
  const { startUtc, endUtc } = userDayWindow(date, tz);
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0)          AS input_tokens,
         COALESCE(SUM(output_tokens), 0)         AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0)     AS cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
         COALESCE(SUM(billed_tokens), 0)         AS billed_tokens,
         COALESCE(SUM(cost_usd), 0)              AS cost_usd,
         COUNT(*)                                AS calls
       FROM llm_usage
       WHERE user_id = ? AND created_at >= ? AND created_at < ?`,
    )
    .get(userId, startUtc.toISOString(), endUtc.toISOString()) as Omit<DayUsage, "total_tokens">;
  return {
    ...row,
    total_tokens:
      row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_creation_tokens,
  };
}

/**
 * Mean (input+output) tokens over the user's most recent N NON-SEARCH AI chat
 * calls, for the "logs left" estimate. Null when there's no such history (caller
 * falls back to a default).
 *
 * `feature` is opt-in. When OMITTED the average spans ALL chat features (meal +
 * insights) — the BLENDED form used by `perSearchPrice` to price a web search as
 * one ordinary turn. When GIVEN, the average is scoped to that surface so each
 * chat panel's "logs left" reflects its OWN per-call cost: meal-chat (~1k
 * tokens) and insights (~5k, it embeds the report briefing) differ ~5x, and
 * blending makes the meal panel show ~1/6th of the logs the user can actually
 * afford.
 *
 * Search calls are ALWAYS excluded (`web_search_requests = 0`), in both forms: a
 * search's `input_tokens` carries the web-result bloat (10k–20k+), so including
 * even one search would drag this average up several-fold and crater the "logs
 * left" count in a single jump (observed in prod: ~85 → ~16). The daily budget
 * debits a search a flat charge (see `perSearchPrice`), not its raw tokens, so
 * the estimate must likewise reflect only ordinary conversation cost.
 */
export function recentAvgTokensPerCall(
  db: Connection,
  userId: number,
  opts?: { feature?: string; limit?: number },
): number | null {
  const limit = opts?.limit ?? 20;
  const feature = opts?.feature;
  const row = feature
    ? (db
        .prepare(
          `SELECT AVG(input_tokens + output_tokens) AS avg
           FROM (SELECT input_tokens, output_tokens FROM llm_usage
                 WHERE user_id = ? AND web_search_requests = 0 AND feature = ?
                 ORDER BY id DESC LIMIT ?)`,
        )
        .get(userId, feature, limit) as { avg: number | null } | undefined)
    : (db
        .prepare(
          `SELECT AVG(input_tokens + output_tokens) AS avg
           FROM (SELECT input_tokens, output_tokens FROM llm_usage
                 WHERE user_id = ? AND web_search_requests = 0
                 ORDER BY id DESC LIMIT ?)`,
        )
        .get(userId, limit) as { avg: number | null } | undefined);
  if (!row || row.avg === null) return null;
  return Math.round(row.avg);
}

/**
 * Sum of web_search_requests over one user-local day (4am rollover, tz-aware).
 * Mirrors getUsageForDay's UTC-range windowing.
 */
export function getSearchesForDay(
  db: Connection,
  userId: number,
  tz: string,
  date: string,
): number {
  const { startUtc, endUtc } = userDayWindow(date, tz);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(web_search_requests), 0) AS n
       FROM llm_usage
       WHERE user_id = ? AND created_at >= ? AND created_at < ?`,
    )
    .get(userId, startUtc.toISOString(), endUtc.toISOString()) as { n: number };
  return row.n;
}

/**
 * Per-search token charge debited from the daily budget: the cost of ONE
 * ordinary chat turn — `recentAvgTokensPerCall` over recent NON-SEARCH calls —
 * with `fallback` (config flat rate) until the user has non-search history.
 *
 * Design intent: a web search debits the budget the SAME as a normal chat turn,
 * no more. The expensive part of a search (the web-result tokens fused into
 * `input_tokens`, plus the per-search dollar fee) is subsidized — it is logged
 * truthfully but NOT charged to the user's token budget. Search VOLUME is
 * governed by the separate daily search cap (`hardDailySearchCap`), which is
 * why that cap exists; the token budget never needs to police searches. This
 * keeps "logs left" honest: a search costs ≈ one log, like any other turn, and
 * the charge tracks real per-turn drift over time.
 *
 * Why not average past SEARCH calls (the original, broken approach): a search's
 * `input_tokens` carries the web-result bloat (10k–20k+), so averaging search
 * rows compounded — each search inflated the next one's price (observed in prod:
 * 2500 → 707 → 4268 → 13378, unbounded). And dividing a multi-search call's
 * fused lump by its search count mixed per-CALL tokens with a per-SEARCH count.
 * A search's true incremental cost is unobservable, so we price it as a normal
 * turn — the one cost we CAN measure cleanly (non-search rows).
 */
export function perSearchPrice(db: Connection, userId: number, fallback: number): number {
  return recentAvgTokensPerCall(db, userId) ?? fallback;
}
