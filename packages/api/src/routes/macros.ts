import type { Connection } from "@almanac/core/db";
import { findDailyNet, findUserById, getUntrackedDays } from "@almanac/core/repos";
import { DayMacrosRangeResponseSchema, DayMacrosResponseSchema } from "@almanac/core/schemas";
import { computeDailyTargetForDate, type DailyTargetOutput } from "@almanac/core/signals";
import { currentUserDate, parseLogTimestamp } from "@almanac/core/types";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";

/**
 * GET /v1/signals/macros — three mutually-exclusive query modes:
 *   ?date=YYYY-MM-DD                → single day { date, day_totals, day_target }
 *   ?from_date=YYYY-MM-DD&to_date=  → { days: [...] } (max 90 days)
 *   ?at=<ISO>                       → resolves the user-day containing `at`
 *
 * Day aggregation runs against the user-TZ window (see `userDayWindow`), so a
 * late-night snack stays on the prior calendar day for accounting purposes.
 *
 * Post-TDEE-refactor, `day_target` is the structured
 * `{ target, maintenance, intake, observed }` block (see
 * `core/schemas/signals.ts` → `DailyTargetResponseSchema`). The static
 * `target` is the phase anchor; `observed` carries today's deltas vs. that
 * target plus the on/off-track verdict.
 */

const DateQuerySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

const RangeQuerySchema = z
  .object({
    from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

const AtQuerySchema = z
  .object({
    at: z.string().min(1),
  })
  .strict();

const QuerySchema = z.union([DateQuerySchema, RangeQuerySchema, AtQuerySchema]);

const ResponseSchema = z.union([DayMacrosResponseSchema, DayMacrosRangeResponseSchema]);

const MAX_RANGE_DAYS = 90;

export const registerMacrosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/signals/macros",
    {
      schema: {
        querystring: QuerySchema,
        response: { 200: ResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const user = findUserById(app.db, userId);
      if (!user) {
        throw new ApiError(404, "not_found", `User ${userId} not found`);
      }
      const tz = user.timezone;

      if ("at" in req.query) {
        let date: string;
        try {
          const instant = parseLogTimestamp(req.query.at, tz);
          date = currentUserDate(instant, tz);
        } catch (err) {
          throw new ApiError(
            400,
            "validation_failed",
            err instanceof Error ? err.message : "invalid `at` parameter",
          );
        }
        return computeForDate(
          app.db,
          userId,
          tz,
          date,
          getUntrackedDays(app.db, userId, date, date).has(date),
        );
      }
      if ("date" in req.query) {
        return computeForDate(
          app.db,
          userId,
          tz,
          req.query.date,
          getUntrackedDays(app.db, userId, req.query.date, req.query.date).has(req.query.date),
        );
      }

      // Range mode.
      const { from_date, to_date } = req.query;
      const dates = enumerateDates(from_date, to_date);
      if (dates.length === 0) {
        throw new ApiError(
          400,
          "validation_failed",
          `to_date (${to_date}) must be >= from_date (${from_date})`,
        );
      }
      if (dates.length > MAX_RANGE_DAYS) {
        throw new ApiError(
          400,
          "validation_failed",
          `Range of ${dates.length} days exceeds max of ${MAX_RANGE_DAYS}`,
        );
      }
      const untrackedSet = getUntrackedDays(app.db, userId, from_date, to_date);
      const days = dates.map((d) => computeForDate(app.db, userId, tz, d, untrackedSet.has(d)));
      return { days };
    },
  );
};

type DayMacros = {
  date: string;
  day_totals: {
    kcal: number;
    protein_g: number;
    carb_g: number;
    fat_g: number;
    kcal_from_food: number;
    kcal_from_alcohol: number;
  };
  day_target: DailyTargetOutput | null;
  net_kcal: number | null;
  untracked: boolean;
};

function computeForDate(
  db: Connection,
  userId: number,
  tz: string,
  date: string,
  untracked: boolean,
): DayMacros {
  const netRow = findDailyNet(db, userId, date);
  const net_kcal = netRow?.net_kcal ?? null;

  // The day-totals + daily-target assembly lives in `computeDailyTargetForDate`
  // (core), shared with the accomplishment adherence detector so the streak's
  // notion of "on track" stays identical to this dashboard's. The phase fork is
  // deliberate: an incomplete active phase is a data-integrity issue here (500),
  // whereas the detector treats it as "not a streak day".
  const result = computeDailyTargetForDate(db, userId, tz, date);
  const day_totals = result.totals;

  if (result.kind === "phase_incomplete") {
    throw new ApiError(
      500,
      "internal",
      `Active phase ${result.phaseId} is missing TDEE refactor fields — data integrity issue.`,
    );
  }
  const day_target = result.kind === "ready" ? result.dayTarget : null;
  return { date, day_totals, day_target, net_kcal, untracked };
}

/**
 * Enumerate inclusive dates from `from` to `to` (YYYY-MM-DD strings). Returns
 * an empty array when `to < from`; the caller maps that to a 400.
 */
function enumerateDates(from: string, to: string): string[] {
  if (to < from) return [];
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    const d = new Date(`${cursor}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    cursor = d.toISOString().slice(0, 10);
  }
  return dates;
}
