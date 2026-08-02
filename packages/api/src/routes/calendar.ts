import { listUntrackedPeriods, listWorkoutsInRangeWithTemplateName } from "@almanac/core/repos";
import { CalendarResponseSchema } from "@almanac/core/schemas";
import { computeCalendarPills } from "@almanac/core/signals";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../auth.js";

/**
 * Read-only `GET /v1/calendar?month=YYYY-MM` — thin wrapper around
 * `computeCalendarPills`. Loads workouts from 14 days before the
 * requested month-start through the end of the month (detrained =
 * 336h = 14d, so a pill can never extend further back than that)
 * and resolves the user's timezone for date bucketing.
 */
export const registerCalendarRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/calendar",
    {
      schema: {
        querystring: z
          .object({
            month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM (01-12)"),
          })
          .strict(),
        response: { 200: CalendarResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);

      const month = req.query.month; // "YYYY-MM", regex-validated above
      const year = Number(month.slice(0, 4));
      const monthNum = Number(month.slice(5, 7)); // 1..12
      const nextMonthStr =
        monthNum === 12 ? `${year + 1}-01` : `${year}-${String(monthNum + 1).padStart(2, "0")}`;

      // Load workouts from 14d before month-start through end of month
      // (exclusive). Detrained = 336h = 14d, so a pill can't extend further.
      const monthStart = `${month}-01`;
      const fourteenDaysBefore = new Date(`${monthStart}T00:00:00Z`);
      fourteenDaysBefore.setUTCDate(fourteenDaysBefore.getUTCDate() - 14);
      const from = `${fourteenDaysBefore.toISOString().slice(0, 10)}T00:00:00Z`;
      // Pad the upper bound one UTC day past next-month-start. A workout done
      // on the month's LAST local evening for a user west of UTC has a
      // started_at that rolls into the next UTC day (e.g. 20:35 EDT Jun 30 ==
      // 2026-07-01T00:35Z); a bare `${nextMonth}-01T00:00:00Z` bound drops it,
      // making it invisible on BOTH months (the signal buckets it user-local
      // to June, so July's month-filter excludes it too). computeCalendarPills
      // re-filters every fetched workout by its user-local date, so the extra
      // day of over-fetch is harmless — it just gets filtered back out.
      // Symmetric with the 14d slop already on `from`.
      const toDate = new Date(`${nextMonthStr}-01T00:00:00Z`);
      toDate.setUTCDate(toDate.getUTCDate() + 1);
      const to = `${toDate.toISOString().slice(0, 10)}T00:00:00Z`;

      const workouts = listWorkoutsInRangeWithTemplateName(app.db, user.id, {
        from,
        to,
        limit: 200,
      });

      // Untracked periods overlapping the month, for calendar shading.
      const monthLastDate = (() => {
        const d = new Date(`${nextMonthStr}-01T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })();
      const untrackedPeriods = listUntrackedPeriods(app.db, user.id, {
        from: monthStart,
        to: monthLastDate,
      });

      return computeCalendarPills({
        workouts: workouts.map((w) => ({
          id: w.id,
          template_id: w.template_id,
          template_name: w.template_name,
          started_at: w.started_at,
        })),
        month,
        timezone: user.timezone,
        now: new Date(),
        untrackedPeriods: untrackedPeriods.map((p) => ({
          started_on: p.started_on,
          ended_on: p.ended_on,
          reason: p.reason,
        })),
      });
    },
  );
};
