/**
 * Why a logging gap exists. A closed enum enforced both at the schema layer
 * (zod) and in SQL (CHECK constraint on untracked_periods.reason).
 */
export type UntrackedReason = "vacation" | "sick" | "deload";

/**
 * A user-declared stretch of days that should NOT be read as "ate zero /
 * stale" by the windowed signals. Inclusive on both ends (closed range):
 * a single-day period has `started_on === ended_on`. The TDEE back-calc
 * excludes these days; response flagging counts them; gap detection clears
 * once a period covers the gap. See
 * docs/superpowers/specs/2026-06-03-untracked-period-design.md.
 */
export type UntrackedPeriod = {
  id: number;
  user_id: number;
  /** YYYY-MM-DD, inclusive. */
  started_on: string;
  /** YYYY-MM-DD, inclusive (closed range). */
  ended_on: string;
  reason: UntrackedReason;
  notes: string | null;
  created_at: string;
};
