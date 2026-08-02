import {
  createStoredMeal,
  deleteStoredMeal,
  findStoredMealById,
  findStoredMealByName,
  listStoredMeals,
  updateStoredMeal,
} from "@almanac/core/repos";
import {
  StoredMealInputSchema,
  StoredMealResponseSchema,
  StoredMealUpdateSchema,
} from "@almanac/core/schemas";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema } from "../params.js";

export const registerStoredMealsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/stored-meals",
    { schema: { response: { 200: z.array(StoredMealResponseSchema) } } },
    async (req) => {
      const userId = requireUserId(req);
      return listStoredMeals(app.db, userId);
    },
  );

  app.get(
    "/v1/stored-meals/:id",
    { schema: { params: IdParamsSchema, response: { 200: StoredMealResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      const found = findStoredMealById(app.db, userId, req.params.id);
      if (!found) throw new ApiError(404, "not_found", `Stored meal ${req.params.id} not found`);
      return found;
    },
  );

  app.post(
    "/v1/stored-meals",
    {
      config: { idempotent: true },
      schema: { body: StoredMealInputSchema, response: { 201: StoredMealResponseSchema } },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const created = createStoredMeal(app.db, { user_id: userId, ...req.body });
      reply.code(201).send(created);
    },
  );

  app.patch(
    "/v1/stored-meals/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: StoredMealUpdateSchema,
        response: { 200: StoredMealResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const existing = findStoredMealById(app.db, userId, req.params.id);
      if (!existing) throw new ApiError(404, "not_found", `Stored meal ${req.params.id} not found`);
      // Pre-check rename collisions so we return a clean 409 rather than a raw
      // SQLite UNIQUE error. A rename to the row's OWN current name is a no-op,
      // allowed.
      if (req.body.name !== undefined && req.body.name !== existing.name) {
        const clash = findStoredMealByName(app.db, userId, req.body.name);
        if (clash) {
          throw new ApiError(
            409,
            "conflict",
            `A stored meal named '${req.body.name}' already exists.`,
          );
        }
      }
      const updated = updateStoredMeal(app.db, userId, req.params.id, req.body);
      if (!updated) throw new ApiError(404, "not_found", `Stored meal ${req.params.id} not found`);
      return updated;
    },
  );

  app.delete("/v1/stored-meals/:id", { schema: { params: IdParamsSchema } }, async (req, reply) => {
    const userId = requireUserId(req);
    deleteStoredMeal(app.db, userId, req.params.id);
    reply.code(204).send();
  });
};
