import {
  createBodyWeight,
  deleteBodyWeight,
  findBodyWeightById,
  listBodyWeights,
  updateBodyWeight,
} from "@almanac/core/repos";
import {
  BodyWeightInputSchema,
  BodyWeightResponseSchema,
  BodyWeightUpdateSchema,
  ListBodyWeightsQuerySchema,
} from "@almanac/core/schemas";
import { persistNewAccomplishments } from "@almanac/core/signals";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema } from "../params.js";

export const registerBodyWeightsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/body-weights",
    {
      schema: {
        querystring: ListBodyWeightsQuerySchema,
        response: { 200: z.array(BodyWeightResponseSchema) },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      return listBodyWeights(app.db, userId, req.query);
    },
  );

  app.get(
    "/v1/body-weights/:id",
    { schema: { params: IdParamsSchema, response: { 200: BodyWeightResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      const found = findBodyWeightById(app.db, userId, req.params.id);
      if (!found) throw new ApiError(404, "not_found", `Body weight ${req.params.id} not found`);
      return found;
    },
  );

  app.post(
    "/v1/body-weights",
    {
      config: { idempotent: true },
      schema: { body: BodyWeightInputSchema, response: { 201: BodyWeightResponseSchema } },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const created = createBodyWeight(app.db, { user_id: userId, ...req.body });
      persistNewAccomplishments(app.db, userId);
      reply.code(201).send(created);
    },
  );

  app.patch(
    "/v1/body-weights/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: BodyWeightUpdateSchema,
        response: { 200: BodyWeightResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const updated = updateBodyWeight(app.db, userId, req.params.id, req.body);
      if (!updated) throw new ApiError(404, "not_found", `Body weight ${req.params.id} not found`);
      persistNewAccomplishments(app.db, userId);
      return updated;
    },
  );

  app.delete("/v1/body-weights/:id", { schema: { params: IdParamsSchema } }, async (req, reply) => {
    const userId = requireUserId(req);
    deleteBodyWeight(app.db, userId, req.params.id);
    reply.code(204).send();
  });
};
