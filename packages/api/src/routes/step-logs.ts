import {
  createOrUpdateStepLog,
  deleteStepLog,
  findStepLogByDate,
  findStepLogById,
  listStepLogs,
  updateStepLog,
} from "@almanac/core/repos";
import {
  IsoDateSchema,
  ListStepLogsQuerySchema,
  StepLogInputSchema,
  StepLogResponseSchema,
  StepLogUpdateSchema,
} from "@almanac/core/schemas";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema } from "../params.js";

export const registerStepLogsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/step-logs",
    {
      schema: {
        querystring: ListStepLogsQuerySchema,
        response: { 200: z.array(StepLogResponseSchema) },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      return listStepLogs(app.db, userId, req.query);
    },
  );

  // Group the GETs together: list, by-date, by-id. Fastify's radix tree
  // prefers a static segment (`by-date`) over a `:param`, and IdParamsSchema
  // rejects non-numeric `:id` values with 422, so declaration order is
  // readability-only — not load-bearing for correctness.
  app.get(
    "/v1/step-logs/by-date/:on_date",
    {
      schema: {
        params: z.object({ on_date: IsoDateSchema }),
        response: { 200: StepLogResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const found = findStepLogByDate(app.db, userId, req.params.on_date);
      if (!found) {
        throw new ApiError(404, "not_found", `No step log for ${req.params.on_date}`);
      }
      return found;
    },
  );

  app.get(
    "/v1/step-logs/:id",
    { schema: { params: IdParamsSchema, response: { 200: StepLogResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      const found = findStepLogById(app.db, userId, req.params.id);
      if (!found) throw new ApiError(404, "not_found", `Step log ${req.params.id} not found`);
      return found;
    },
  );

  app.post(
    "/v1/step-logs",
    {
      config: { idempotent: true },
      schema: { body: StepLogInputSchema, response: { 201: StepLogResponseSchema } },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const created = createOrUpdateStepLog(app.db, { user_id: userId, ...req.body });
      reply.code(201).send(created);
    },
  );

  app.patch(
    "/v1/step-logs/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: StepLogUpdateSchema,
        response: { 200: StepLogResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const updated = updateStepLog(app.db, userId, req.params.id, req.body);
      if (!updated) throw new ApiError(404, "not_found", `Step log ${req.params.id} not found`);
      return updated;
    },
  );

  app.delete("/v1/step-logs/:id", { schema: { params: IdParamsSchema } }, async (req, reply) => {
    const userId = requireUserId(req);
    deleteStepLog(app.db, userId, req.params.id);
    reply.code(204).send();
  });
};
