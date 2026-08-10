/**
 * Ratio the two tiers are held at. Used in both directions: to derive a missing
 * hard cap from the soft limit, and to pull the soft limit back down under a cap
 * that would otherwise sit below it.
 */
export const DERIVED_HARD_CAP_MULTIPLIER = 1.5;

/**
 * Boot check for the env pair. A hard cap at or below the soft limit is a
 * misconfiguration: `resolveDailyLimits` will pull the soft limit down to keep
 * the tiers coherent, so nothing breaks, but the operator's configured soft
 * limit silently stops being the number in force. Worth saying out loud once at
 * startup rather than leaving them to notice the counter is wrong.
 *
 * Returns null when the pair is fine, or when either side is unset.
 */
export function llmLimitConfigError(
  envSoft: number | null | undefined,
  envCap: number | null | undefined,
): string | null {
  if (typeof envSoft !== "number" || typeof envCap !== "number") return null;
  if (envCap > envSoft) return null;
  return (
    `ALMANAC_LLM_HARD_DAILY_TOKEN_CAP (${envCap}) is not above ` +
    `ALMANAC_LLM_DEFAULT_DAILY_TOKEN_LIMIT (${envSoft}). The hard cap must exceed the soft ` +
    `limit or users hit a 429 before the advisory counter runs out. The soft limit will be ` +
    `treated as ${Math.floor(envCap / DERIVED_HARD_CAP_MULTIPLIER)} until this is fixed.`
  );
}

export type DailyLimitInputs = {
  envSoft: number | null | undefined;
  userSoft: number | null | undefined;
  envCap: number | null | undefined;
  userCap: number | null | undefined;
};

export type DailyLimits = {
  /** Advisory budget behind the "logs left" counter. Never blocks. */
  softLimit: number | null;
  /** The ceiling that 429s. Always strictly above `softLimit` when both exist. */
  hardCap: number | null;
};

const set = (...values: Array<number | null | undefined>) =>
  values.filter((v): v is number => typeof v === "number");

/**
 * Resolve both daily tiers together. They have to be resolved as a pair: the
 * hard cap can be derived from the soft limit, and a configured cap can force
 * the soft limit down, so computing either alone lets them contradict.
 *
 * The invariant is that the hard cap is STRICTLY above the soft limit whenever
 * both exist. Otherwise the counter promises headroom the cap won't honour and
 * the user meets a 429 with the pill still reading "5 logs left", which is the
 * surprise the two-tier design exists to prevent.
 *
 * Resolution order:
 *
 * 1. Soft limit: the user's own value, else the env default.
 * 2. Hard cap: the LOWER of the env and per-user caps, so a per-user value can
 *    only tighten against the operator's. An explicitly configured cap is always
 *    honoured, including one far above the derived value, because granting
 *    somebody extra headroom is a deliberate act.
 * 3. With no cap configured, derive one at `DERIVED_HARD_CAP_MULTIPLIER` times
 *    the soft limit, so an install that never sets one still has a backstop.
 * 4. With a cap at or below the soft limit, pull the soft limit down to
 *    cap ÷ multiplier rather than weakening the cap. The admin asked for that
 *    ceiling; what has to give is the advisory number under it.
 *
 * Nulls are not zeros. A per-user cap with no env cap has to bite on its own,
 * which a plain `Math.min` over a null env would drop.
 */
export function resolveDailyLimits(inputs: DailyLimitInputs): DailyLimits {
  const softConfigured = inputs.userSoft ?? inputs.envSoft ?? null;
  const capsConfigured = set(inputs.envCap, inputs.userCap);

  if (capsConfigured.length === 0) {
    if (softConfigured === null) return { softLimit: null, hardCap: null };
    return {
      softLimit: softConfigured,
      hardCap: Math.round(softConfigured * DERIVED_HARD_CAP_MULTIPLIER),
    };
  }

  const hardCap = Math.min(...capsConfigured);
  if (softConfigured === null) return { softLimit: null, hardCap };

  // floor, not round, so the result stays strictly below the cap.
  const headroom = Math.floor(hardCap / DERIVED_HARD_CAP_MULTIPLIER);
  return { softLimit: Math.min(softConfigured, headroom), hardCap };
}
