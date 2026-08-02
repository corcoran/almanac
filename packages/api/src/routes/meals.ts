import { createMeal, deleteMeal, findMealById, listMeals, updateMeal } from "@almanac/core/repos";
import {
  ListMealsQuerySchema,
  MealInputSchema,
  MealResponseSchema,
  MealUpdateSchema,
} from "@almanac/core/schemas";
import { persistNewAccomplishments } from "@almanac/core/signals";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema, normalizeTimestamp, resolveDateRange } from "../params.js";
import { recomputeNetForEvent } from "./day-net.js";

export const registerMealsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/meals",
    {
      schema: {
        querystring: ListMealsQuerySchema,
        response: { 200: z.array(MealResponseSchema) },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      const range = resolveDateRange(req.query, user);
      return listMeals(app.db, user.id, { ...range, limit: req.query.limit });
    },
  );

  app.get(
    "/v1/meals/:id",
    { schema: { params: IdParamsSchema, response: { 200: MealResponseSchema } } },
    async (req) => {
      const user = requireUser(app.db, req);
      const found = findMealById(app.db, user.id, req.params.id);
      if (!found) throw new ApiError(404, "not_found", `Meal ${req.params.id} not found`);
      return found;
    },
  );

  app.post(
    "/v1/meals",
    {
      config: { idempotent: true },
      schema: { body: MealInputSchema, response: { 201: MealResponseSchema } },
    },
    async (req, reply) => {
      const user = requireUser(app.db, req);
      const body = normalizeTimestamp(req.body, "eaten_at", user.timezone);
      const created = createMeal(app.db, { user_id: user.id, ...body });
      recomputeNetForEvent(app.db, user.id, user.timezone, created.eaten_at);
      persistNewAccomplishments(app.db, user.id);
      reply.code(201).send(created);
    },
  );

  app.patch(
    "/v1/meals/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: MealUpdateSchema,
        response: { 200: MealResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      const existing = findMealById(app.db, user.id, req.params.id);
      if (!existing) throw new ApiError(404, "not_found", `Meal ${req.params.id} not found`);
      const body = normalizeTimestamp(req.body, "eaten_at", user.timezone);
      const updated = updateMeal(app.db, user.id, req.params.id, body);
      if (!updated) throw new ApiError(404, "not_found", `Meal ${req.params.id} not found`);
      recomputeNetForEvent(app.db, user.id, user.timezone, existing.eaten_at, updated.eaten_at);
      persistNewAccomplishments(app.db, user.id);
      return updated;
    },
  );

  app.delete("/v1/meals/:id", { schema: { params: IdParamsSchema } }, async (req, reply) => {
    const user = requireUser(app.db, req);
    const existing = findMealById(app.db, user.id, req.params.id);
    deleteMeal(app.db, user.id, req.params.id);
    if (existing) {
      recomputeNetForEvent(app.db, user.id, user.timezone, existing.eaten_at);
    }
    reply.code(204).send();
  });
};
