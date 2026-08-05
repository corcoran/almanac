import { updateUser } from "@almanac/core/repos";
import { UserResponseSchema, UserUpdateSchema } from "@almanac/core/schemas";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireUser, requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";

/**
 * User routes are `/me`-scoped only. There is deliberately no account-creation
 * endpoint: accounts are provisioned by the auth layer on first sign-in
 * (`resolveEmailToUserId` in auth.ts), which is the single path that writes a
 * `users` row in production and always sets the verified email.
 */
export const registerUsersRoutes: FastifyPluginAsyncZod = async (app) => {
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
