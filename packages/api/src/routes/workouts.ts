import {
  addExerciseInstance,
  applyTemplateWithDeviations,
  createWorkout,
  deleteSet,
  deleteWorkout,
  findSetByIdForUser,
  findWorkoutByIdForUser,
  listWorkoutsInRange,
  listWorkoutsWithDetail,
  updateSet,
  updateWorkout,
} from "@almanac/core/repos";
import {
  AddExerciseInstanceBodySchema,
  CreateWorkoutBodySchema,
  ListWorkoutsQuerySchema,
  SetUpdateSchema,
  WorkoutResponseSchema,
  WorkoutUpdateSchema,
} from "@almanac/core/schemas";
import { persistNewAccomplishments } from "@almanac/core/signals";
import { currentUserDate, parseLogTimestamp, userDayWindow } from "@almanac/core/types";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser, requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema, normalizeTimestamp } from "../params.js";

export const registerWorkoutsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ------- GET /v1/workouts ----------------------------------------------
  app.get(
    "/v1/workouts",
    {
      schema: {
        querystring: ListWorkoutsQuerySchema,
        response: { 200: z.array(WorkoutResponseSchema) },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      return listWorkoutsInRange(app.db, userId, req.query);
    },
  );

  // ------- GET /v1/workouts/:id ------------------------------------------
  app.get(
    "/v1/workouts/:id",
    { schema: { params: IdParamsSchema, response: { 200: WorkoutResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      const found = findWorkoutByIdForUser(app.db, userId, req.params.id);
      if (!found) throw new ApiError(404, "not_found", `Workout ${req.params.id} not found`);
      return found;
    },
  );

  // ------- GET /v1/workouts/by-date --------------------------------------
  // The day's workouts WITH full exercise/set detail (unlike GET /v1/workouts,
  // which returns summaries). `date` optional → today in the user's tz. Powers
  // the insights coach's get_workout_for_day so it answers "how was my push
  // today" from real data instead of guessing.
  app.get(
    "/v1/workouts/by-date",
    {
      schema: {
        querystring: z
          .object({
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
          })
          .strict(),
        response: { 200: z.array(WorkoutResponseSchema) },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      const day = req.query.date ?? currentUserDate(new Date(), user.timezone);
      const { startUtc, endUtc } = userDayWindow(day, user.timezone);
      return listWorkoutsWithDetail(app.db, user.id, {
        from: startUtc.toISOString(),
        to: endUtc.toISOString(),
        limit: 50,
      });
    },
  );

  // ------- POST /v1/workouts (dual-shape) --------------------------------
  app.post(
    "/v1/workouts",
    {
      schema: { body: CreateWorkoutBodySchema, response: { 201: WorkoutResponseSchema } },
    },
    async (req, reply) => {
      const user = requireUser(app.db, req);
      const body = req.body;
      // Normalize started_at once — used both as the workout's anchor and as
      // the skipped_at timestamp for any `skip` deviations (so retro-logged
      // workouts don't lie about when the skip happened).
      const startedAt = parseLogTimestamp(body.started_at, user.timezone).toISOString();
      let exercises: Parameters<typeof createWorkout>[1]["exercises"];
      if ("deviations" in body) {
        try {
          const resolved = applyTemplateWithDeviations(
            app.db,
            body.template_id,
            body.deviations,
            startedAt,
          );
          exercises = resolved.map((r) => ({
            exercise_id: r.exercise_id,
            display_order: r.display_order,
            planned_sets: r.planned_sets,
            sets: r.sets,
            skipped_at: r.skipped_at,
          }));
        } catch (err) {
          // applyTemplateWithDeviations throws on invariant violations
          // (skip/override of non-template exercise, add of existing exercise).
          // Surface as 422 with the resolver's message.
          const msg = (err as Error).message;
          if (
            msg.startsWith("Cannot skip ") ||
            msg.startsWith("Cannot override ") ||
            msg.startsWith("Cannot add ")
          ) {
            throw new ApiError(422, "validation_failed", msg);
          }
          throw err;
        }
      } else {
        exercises = body.exercises;
      }
      const workout = createWorkout(app.db, {
        user_id: user.id,
        template_id: body.template_id ?? null,
        started_at: startedAt,
        duration_min: body.duration_min ?? null,
        rpe: body.rpe,
        est_kcal: body.est_kcal ?? null,
        notes: body.notes ?? null,
        exercises,
      });
      persistNewAccomplishments(app.db, user.id);
      reply.code(201).send(workout);
    },
  );

  // ------- PATCH /v1/workouts/:id ----------------------------------------
  app.patch(
    "/v1/workouts/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: WorkoutUpdateSchema,
        response: { 200: WorkoutResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      const body = normalizeTimestamp(req.body, "started_at", user.timezone);
      const updated = updateWorkout(app.db, user.id, req.params.id, body);
      if (!updated) throw new ApiError(404, "not_found", `Workout ${req.params.id} not found`);
      return updated;
    },
  );

  // ------- DELETE /v1/workouts/:id ---------------------------------------
  app.delete("/v1/workouts/:id", { schema: { params: IdParamsSchema } }, async (req, reply) => {
    const userId = requireUserId(req);
    deleteWorkout(app.db, userId, req.params.id);
    reply.code(204).send();
  });

  // ------- POST /v1/workouts/:id/exercise-instances ----------------------
  app.post(
    "/v1/workouts/:id/exercise-instances",
    {
      schema: {
        params: IdParamsSchema,
        body: AddExerciseInstanceBodySchema,
      },
    },
    async (req, reply) => {
      const userId = requireUserId(req);
      // Confirm the parent exists AND belongs to the caller, so a stale or
      // other-user workout id returns 404 (not a FK error or a cross-user write).
      const parent = findWorkoutByIdForUser(app.db, userId, req.params.id);
      if (!parent) throw new ApiError(404, "not_found", `Workout ${req.params.id} not found`);
      const created = addExerciseInstance(app.db, req.params.id, req.body);
      reply.code(201).send(created);
    },
  );

  // ------- PATCH /v1/sets/:id --------------------------------------------
  app.patch(
    "/v1/sets/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: SetUpdateSchema,
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const existing = findSetByIdForUser(app.db, userId, req.params.id);
      if (!existing) throw new ApiError(404, "not_found", `Set ${req.params.id} not found`);
      const updated = updateSet(app.db, userId, req.params.id, req.body);
      if (!updated) throw new ApiError(404, "not_found", `Set ${req.params.id} not found`);
      return updated;
    },
  );

  // ------- DELETE /v1/sets/:id -------------------------------------------
  app.delete("/v1/sets/:id", { schema: { params: IdParamsSchema } }, async (req, reply) => {
    const userId = requireUserId(req);
    deleteSet(app.db, userId, req.params.id);
    reply.code(204).send();
  });
};
