import {
  createUntrackedPeriod,
  deleteUntrackedPeriod,
  findUntrackedPeriodById,
  listUntrackedPeriods,
} from "@almanac/core/repos";
import {
  CreateUntrackedPeriodInputSchema,
  ErrorBodySchema,
  ListUntrackedPeriodsQuerySchema,
  PeriodOverlapErrorSchema,
  UntrackedPeriodResponseSchema,
} from "@almanac/core/schemas";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema } from "../params.js";

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const registerUntrackedPeriodsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/untracked-periods",
    {
      schema: {
        querystring: ListUntrackedPeriodsQuerySchema,
        response: { 200: z.array(UntrackedPeriodResponseSchema) },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const today = new Date().toISOString().slice(0, 10);
      const from = req.query.from_date ?? addDaysIso(today, -90);
      const to = req.query.to_date ?? today;
      return listUntrackedPeriods(app.db, userId, { from, to });
    },
  );

  app.post(
    "/v1/untracked-periods",
    {
      schema: {
        body: CreateUntrackedPeriodInputSchema,
        // 422 carries two shapes: the `period_overlap` envelope this handler
        // sends directly, and the generic `validation_failed` envelope the
        // error handler emits for bad input (e.g. ended_on < started_on). The
        // union lets the typed reply accept the former while keeping the latter
        // serializable, so no `(reply as any)` cast is needed.
        response: {
          201: UntrackedPeriodResponseSchema,
          422: z.union([PeriodOverlapErrorSchema, ErrorBodySchema]),
        },
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const body = req.body;
      const overlapping = listUntrackedPeriods(app.db, userId, {
        from: body.started_on,
        to: body.ended_on,
      });
      const conflict = overlapping[0];
      if (conflict !== undefined) {
        const envelope = PeriodOverlapErrorSchema.parse({
          error: "period_overlap",
          message: `New period ${body.started_on}..${body.ended_on} overlaps existing period ${conflict.started_on}..${conflict.ended_on}. A date belongs to at most one period — delete the existing one first if you meant to edit it.`,
          conflicting_period: conflict,
        });
        return reply.code(422).send(envelope);
      }
      const created = createUntrackedPeriod(app.db, {
        user_id: userId,
        started_on: body.started_on,
        ended_on: body.ended_on,
        reason: body.reason,
        notes: body.notes,
      });
      return reply.code(201).send(created);
    },
  );

  app.delete(
    "/v1/untracked-periods/:id",
    { schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const userId = requireUserId(req);
      const found = findUntrackedPeriodById(app.db, req.params.id);
      if (!found || found.user_id !== userId) {
        throw new ApiError(404, "not_found", `Untracked period ${req.params.id} not found`);
      }
      deleteUntrackedPeriod(app.db, userId, req.params.id);
      reply.code(204).send();
    },
  );
};
