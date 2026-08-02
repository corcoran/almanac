import type { Connection } from "@almanac/core/db";
import type { User } from "@almanac/core/types";
import type { FastifyRequest } from "fastify";
import { requireUser } from "./auth.js";
import { ApiError } from "./errors.js";

/**
 * Throwing guard for admin-only routes — parallels requireUser. Resolves the
 * authenticated user (401 if unauthenticated), then 403s unless is_admin = 1.
 * Hard server-side check: never trust a client claim of admin.
 */
export function requireAdmin(db: Connection, req: FastifyRequest): User {
  const user = requireUser(db, req);
  if (user.is_admin !== 1) {
    throw new ApiError(403, "forbidden", "Admin access required");
  }
  return user;
}
