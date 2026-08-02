import {
  createSleepLog,
  deleteSleepLog,
  findSleepLogById,
  listSleepLogs,
  updateSleepLog,
} from "@almanac/core/repos";
import {
  ListSleepLogsQuerySchema,
  SleepLogInputSchema,
  SleepLogResponseSchema,
  SleepLogUpdateSchema,
} from "@almanac/core/schemas";
import { persistNewAccomplishments } from "@almanac/core/signals";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema } from "../params.js";

export const registerSleepRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/sleep-logs",
    {
      schema: {
        querystring: ListSleepLogsQuerySchema,
        response: { 200: z.array(SleepLogResponseSchema) },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      return listSleepLogs(app.db, userId, req.query);
    },
  );

  app.get(
    "/v1/sleep-logs/:id",
    { schema: { params: IdParamsSchema, response: { 200: SleepLogResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      const found = findSleepLogById(app.db, userId, req.params.id);
      if (!found) throw new ApiError(404, "not_found", `Sleep log ${req.params.id} not found`);
      return found;
    },
  );

  app.post(
    "/v1/sleep-logs",
    {
      config: { idempotent: true },
      schema: { body: SleepLogInputSchema, response: { 201: SleepLogResponseSchema } },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const created = createSleepLog(app.db, { user_id: userId, ...req.body });
      persistNewAccomplishments(app.db, userId);
      reply.code(201).send(created);
    },
  );

  app.patch(
    "/v1/sleep-logs/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: SleepLogUpdateSchema,
        response: { 200: SleepLogResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const updated = updateSleepLog(app.db, userId, req.params.id, req.body);
      if (!updated) throw new ApiError(404, "not_found", `Sleep log ${req.params.id} not found`);
      persistNewAccomplishments(app.db, userId);
      return updated;
    },
  );

  app.delete("/v1/sleep-logs/:id", { schema: { params: IdParamsSchema } }, async (req, reply) => {
    const userId = requireUserId(req);
    deleteSleepLog(app.db, userId, req.params.id);
    reply.code(204).send();
  });
};
