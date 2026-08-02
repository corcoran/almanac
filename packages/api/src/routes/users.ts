import { seedUser } from "@almanac/core/bootstrap";
import { findUserById, updateUser } from "@almanac/core/repos";
import {
  BootstrapUserInputSchema,
  UserResponseSchema,
  UserUpdateSchema,
} from "@almanac/core/schemas";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireUser, requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";

export const registerUsersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/users",
    {
      schema: {
        body: BootstrapUserInputSchema,
        response: { 201: UserResponseSchema },
      },
    },
    async (req, reply) => {
      const existing = app.db.prepare("SELECT id FROM users LIMIT 1").get() as
        | { id: number }
        | undefined;
      if (existing) {
        throw new ApiError(
          409,
          "conflict",
          `User already exists (id=${existing.id}); this app is single-user.`,
        );
      }
      const { user_id } = seedUser(app.db, {
        name: req.body.name,
        dob: req.body.dob ?? null,
        height_cm: req.body.height_cm ?? null,
        sex: req.body.sex ?? null,
      });
      // Patch timezone / preferred_unit_system / activity_level if the body
      // specified them. updateUser's UPDATABLE_COLUMNS already allows all three;
      // column defaults ('UTC' / 'metric' / NULL) apply when omitted.
      const patch: {
        timezone?: string;
        preferred_unit_system?: "metric" | "imperial";
        activity_level?: "sedentary" | "light" | "moderate" | "active" | "very_active";
      } = {};
      if (req.body.timezone !== undefined) patch.timezone = req.body.timezone;
      if (req.body.preferred_unit_system !== undefined)
        patch.preferred_unit_system = req.body.preferred_unit_system;
      if (req.body.activity_level !== undefined) patch.activity_level = req.body.activity_level;
      const user =
        Object.keys(patch).length > 0
          ? updateUser(app.db, user_id, patch)
          : findUserById(app.db, user_id);
      if (!user) throw new ApiError(500, "internal", "user disappeared after insert");
      reply.code(201).send(user);
    },
  );

  app.get("/v1/users/me", { schema: { response: { 200: UserResponseSchema } } }, async (req) => {
    return requireUser(app.db, req);
  });

  app.patch(
    "/v1/users/me",
    { schema: { body: UserUpdateSchema, response: { 200: UserResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      const updated = updateUser(app.db, userId, req.body);
      if (!updated) throw new ApiError(404, "not_found", `User ${userId} not found`);
      return updated;
    },
  );
};
