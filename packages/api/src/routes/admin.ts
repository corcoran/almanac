import { findUserById, listUsers, updateUser } from "@almanac/core/repos";
import { AdminUserSummarySchema, AdminUserUpdateSchema } from "@almanac/core/schemas";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAdmin } from "../admin-gate.js";
import { ApiError } from "../errors.js";

const IdParams = z.object({ id: z.coerce.number().int().positive() }).strict();

/**
 * Admin-only user management. Every handler calls requireAdmin first (hard
 * server-side check). Bootstrapping the FIRST admin is a one-time DB edit
 * (UPDATE users SET is_admin = 1 WHERE email = '...') — intentionally not an
 * endpoint, to avoid an unauthenticated privilege-escalation surface.
 */
export const registerAdminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/admin/users",
    { schema: { response: { 200: z.array(AdminUserSummarySchema) } } },
    async (req) => {
      requireAdmin(app.db, req);
      return listUsers(app.db);
    },
  );

  app.patch(
    "/v1/admin/users/:id",
    {
      schema: {
        params: IdParams,
        body: AdminUserUpdateSchema,
        response: { 200: AdminUserSummarySchema },
      },
    },
    async (req) => {
      requireAdmin(app.db, req);
      const target = findUserById(app.db, req.params.id);
      if (!target) throw new ApiError(404, "not_found", `User ${req.params.id} not found`);
      const updated = updateUser(app.db, req.params.id, req.body);
      if (!updated) throw new ApiError(404, "not_found", `User ${req.params.id} not found`);
      return {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        llm_logging_enabled: updated.llm_logging_enabled,
        is_admin: updated.is_admin,
        llm_daily_token_limit: updated.llm_daily_token_limit,
      };
    },
  );
};
