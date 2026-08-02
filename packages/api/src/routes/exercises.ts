import {
  archiveExercise,
  createExercise,
  findExerciseById,
  listExercises,
  unarchiveExercise,
  updateExercise,
} from "@almanac/core/repos";
import {
  ExerciseInputSchema,
  ExerciseResponseSchema,
  ExerciseUpdateSchema,
  ListExercisesQuerySchema,
} from "@almanac/core/schemas";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema } from "../params.js";

export const registerExercisesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/exercises",
    {
      schema: {
        querystring: ListExercisesQuerySchema,
        response: { 200: z.array(ExerciseResponseSchema) },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      return listExercises(app.db, userId, {
        groupId: req.query.group_id,
        includeArchived: req.query.include_archived,
      });
    },
  );

  app.get(
    "/v1/exercises/:id",
    { schema: { params: IdParamsSchema, response: { 200: ExerciseResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      const found = findExerciseById(app.db, userId, req.params.id);
      if (!found) throw new ApiError(404, "not_found", `Exercise ${req.params.id} not found`);
      return found;
    },
  );

  app.post(
    "/v1/exercises",
    { schema: { body: ExerciseInputSchema, response: { 201: ExerciseResponseSchema } } },
    async (req, reply) => {
      const userId = requireUserId(req);
      const created = createExercise(app.db, { user_id: userId, ...req.body });
      reply.code(201).send(created);
    },
  );

  app.patch(
    "/v1/exercises/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: ExerciseUpdateSchema,
        response: { 200: ExerciseResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const updated = updateExercise(app.db, userId, req.params.id, req.body);
      if (!updated) throw new ApiError(404, "not_found", `Exercise ${req.params.id} not found`);
      return updated;
    },
  );

  app.delete("/v1/exercises/:id", { schema: { params: IdParamsSchema } }, async (req, reply) => {
    const userId = requireUserId(req);
    archiveExercise(app.db, userId, req.params.id);
    reply.code(204).send();
  });

  app.post(
    "/v1/exercises/:id/unarchive",
    { schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const userId = requireUserId(req);
      unarchiveExercise(app.db, userId, req.params.id);
      reply.code(204).send();
    },
  );
};
