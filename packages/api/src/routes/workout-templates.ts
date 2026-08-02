import {
  archiveTemplate,
  createTemplate,
  findTemplateById,
  listTemplates,
  replaceTemplateItems,
  unarchiveTemplate,
  updateTemplate,
} from "@almanac/core/repos";
import {
  ListWorkoutTemplatesQuerySchema,
  ReplaceTemplateItemsBodySchema,
  WorkoutTemplateInputSchema,
  WorkoutTemplateResponseSchema,
  WorkoutTemplateUpdateSchema,
} from "@almanac/core/schemas";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema } from "../params.js";

export const registerWorkoutTemplatesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/workout-templates",
    {
      schema: {
        querystring: ListWorkoutTemplatesQuerySchema,
        response: { 200: z.array(WorkoutTemplateResponseSchema) },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      return listTemplates(app.db, userId, { includeArchived: req.query.include_archived });
    },
  );

  app.get(
    "/v1/workout-templates/:id",
    { schema: { params: IdParamsSchema, response: { 200: WorkoutTemplateResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      const found = findTemplateById(app.db, userId, req.params.id);
      if (!found) throw new ApiError(404, "not_found", `Template ${req.params.id} not found`);
      return found;
    },
  );

  app.post(
    "/v1/workout-templates",
    {
      schema: {
        body: WorkoutTemplateInputSchema,
        response: { 201: WorkoutTemplateResponseSchema },
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      const created = createTemplate(app.db, { user_id: userId, ...req.body });
      reply.code(201).send(created);
    },
  );

  app.patch(
    "/v1/workout-templates/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: WorkoutTemplateUpdateSchema,
        response: { 200: WorkoutTemplateResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const updated = updateTemplate(app.db, userId, req.params.id, req.body);
      if (!updated) throw new ApiError(404, "not_found", `Template ${req.params.id} not found`);
      return updated;
    },
  );

  app.put(
    "/v1/workout-templates/:id/items",
    {
      schema: {
        params: IdParamsSchema,
        body: ReplaceTemplateItemsBodySchema,
        response: { 200: WorkoutTemplateResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      // Verify ownership before mutating child items — replaceTemplateItems is
      // keyed only by template_id, so guard via the user-scoped template lookup.
      if (!findTemplateById(app.db, userId, req.params.id)) {
        throw new ApiError(404, "not_found", `Template ${req.params.id} not found`);
      }
      replaceTemplateItems(app.db, req.params.id, req.body.items);
      const refreshed = findTemplateById(app.db, userId, req.params.id);
      if (!refreshed) throw new ApiError(404, "not_found", `Template ${req.params.id} not found`);
      return refreshed;
    },
  );

  app.delete(
    "/v1/workout-templates/:id",
    { schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const userId = requireUserId(req);
      archiveTemplate(app.db, userId, req.params.id);
      reply.code(204).send();
    },
  );

  app.post(
    "/v1/workout-templates/:id/unarchive",
    { schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const userId = requireUserId(req);
      unarchiveTemplate(app.db, userId, req.params.id);
      reply.code(204).send();
    },
  );
};
