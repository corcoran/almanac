import {
  createAlcoholSession,
  deleteAlcoholSession,
  findAlcoholSessionById,
  listAlcoholSessions,
  updateAlcoholSession,
} from "@almanac/core/repos";
import {
  AlcoholSessionInputSchema,
  AlcoholSessionResponseSchema,
  AlcoholSessionUpdateSchema,
  ListAlcoholSessionsQuerySchema,
} from "@almanac/core/schemas";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema, normalizeTimestamp, resolveDateRange } from "../params.js";
import { recomputeNetForEvent } from "./day-net.js";

export const registerAlcoholRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/alcohol-sessions",
    {
      schema: {
        querystring: ListAlcoholSessionsQuerySchema,
        response: { 200: z.array(AlcoholSessionResponseSchema) },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      const range = resolveDateRange(req.query, user);
      return listAlcoholSessions(app.db, user.id, { ...range, limit: req.query.limit });
    },
  );

  app.get(
    "/v1/alcohol-sessions/:id",
    { schema: { params: IdParamsSchema, response: { 200: AlcoholSessionResponseSchema } } },
    async (req) => {
      const user = requireUser(app.db, req);
      const found = findAlcoholSessionById(app.db, user.id, req.params.id);
      if (!found)
        throw new ApiError(404, "not_found", `Alcohol session ${req.params.id} not found`);
      return found;
    },
  );

  app.post(
    "/v1/alcohol-sessions",
    {
      config: { idempotent: true },
      schema: { body: AlcoholSessionInputSchema, response: { 201: AlcoholSessionResponseSchema } },
    },
    async (req, reply) => {
      const user = requireUser(app.db, req);
      let body = normalizeTimestamp(req.body, "started_at", user.timezone);
      body = normalizeTimestamp(body, "ended_at", user.timezone);
      const created = createAlcoholSession(app.db, { user_id: user.id, ...body });
      recomputeNetForEvent(app.db, user.id, user.timezone, created.started_at);
      reply.code(201).send(created);
    },
  );

  app.patch(
    "/v1/alcohol-sessions/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: AlcoholSessionUpdateSchema,
        response: { 200: AlcoholSessionResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      const existing = findAlcoholSessionById(app.db, user.id, req.params.id);
      if (!existing)
        throw new ApiError(404, "not_found", `Alcohol session ${req.params.id} not found`);
      let body = normalizeTimestamp(req.body, "started_at", user.timezone);
      body = normalizeTimestamp(body, "ended_at", user.timezone);
      const updated = updateAlcoholSession(app.db, user.id, req.params.id, body);
      if (!updated)
        throw new ApiError(404, "not_found", `Alcohol session ${req.params.id} not found`);
      recomputeNetForEvent(app.db, user.id, user.timezone, existing.started_at, updated.started_at);
      return updated;
    },
  );

  app.delete(
    "/v1/alcohol-sessions/:id",
    { schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const user = requireUser(app.db, req);
      const existing = findAlcoholSessionById(app.db, user.id, req.params.id);
      deleteAlcoholSession(app.db, user.id, req.params.id);
      if (existing) {
        recomputeNetForEvent(app.db, user.id, user.timezone, existing.started_at);
      }
      reply.code(204).send();
    },
  );
};
