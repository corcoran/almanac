import {
  createGroup,
  deleteGroup,
  findGroupById,
  listGroups,
  updateGroup,
} from "@almanac/core/repos";
import {
  ExerciseGroupInputSchema,
  ExerciseGroupResponseSchema,
  ExerciseGroupUpdateSchema,
} from "@almanac/core/schemas";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema } from "../params.js";

export const registerExerciseGroupsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/exercise-groups",
    { schema: { response: { 200: z.array(ExerciseGroupResponseSchema) } } },
    async (req) => {
      const userId = requireUserId(req);
      return listGroups(app.db, userId);
    },
  );

  app.get(
    "/v1/exercise-groups/:id",
    { schema: { params: IdParamsSchema, response: { 200: ExerciseGroupResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      const found = findGroupById(app.db, userId, req.params.id);
      if (!found) throw new ApiError(404, "not_found", `Group ${req.params.id} not found`);
      return found;
    },
  );

  app.post(
    "/v1/exercise-groups",
    { schema: { body: ExerciseGroupInputSchema, response: { 201: ExerciseGroupResponseSchema } } },
    async (req, reply) => {
      const userId = requireUserId(req);
      const created = createGroup(app.db, { user_id: userId, ...req.body });
      reply.code(201).send(created);
    },
  );

  app.patch(
    "/v1/exercise-groups/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: ExerciseGroupUpdateSchema,
        response: { 200: ExerciseGroupResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const updated = updateGroup(app.db, userId, req.params.id, req.body);
      if (!updated) throw new ApiError(404, "not_found", `Group ${req.params.id} not found`);
      return updated;
    },
  );

  app.delete(
    "/v1/exercise-groups/:id",
    { schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const userId = requireUserId(req);
      deleteGroup(app.db, userId, req.params.id);
      reply.code(204).send();
    },
  );
};
