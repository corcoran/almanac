import type { Connection } from "@almanac/core/db";
import { bumpLastUsed, findActiveUserIdByToken, findUserById } from "@almanac/core/repos";
import type { User } from "@almanac/core/types";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";

/**
 * Narrow `req.userId` (typed optional because PUBLIC_PATHS routes have none)
 * to a concrete number on authenticated routes. The auth preHandler sets it on
 * every non-public route, so the throw is defense-in-depth — it converts a
 * would-be silent `undefined` into a clear 401 rather than a downstream crash.
 */
export function requireUserId(req: FastifyRequest): number {
  if (req.userId === undefined) {
    throw new ApiError(
      401,
      "unauthorized",
      "Request reached a handler without an authenticated user",
    );
  }
  return req.userId;
}

/**
 * Resolve the authenticated request to its `User` row, or throw. Bundles the
 * `requireUserId` → `findUserById` → 404 preamble that every route needs the
 * user's timezone for (timestamp normalization, day bucketing). The 404 is
 * defense-in-depth: the preHandler resolved a valid userId, so a missing row
 * means the user was deleted mid-request rather than a client error.
 */
export function requireUser(db: Connection, req: FastifyRequest): User {
  const userId = requireUserId(req);
  const user = findUserById(db, userId);
  if (!user) throw new ApiError(404, "not_found", `User ${userId} not found`);
  return user;
}

/**
 * Routes whose paths match these exact strings bypass auth. Useful for
 * probes (tunnel/load-balancer health checks) that cannot present a token.
 * Keep this list minimal — every entry expands the unauthenticated surface.
 */
const PUBLIC_PATHS = new Set<string>(["/api/v1/health", "/api/v1/version"]);

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Set by `authPreHandler` after either the token or header path
     * resolves a user. Present on every authenticated route, absent on
     * PUBLIC_PATHS — handlers narrow it via `requireUserId(req)`.
     */
    userId?: number;
  }
}

export type AuthDeps = {
  db: Connection;
  trustProxyHeaders: boolean;
  /** When non-empty, only these emails may auto-provision a user row. */
  allowedEmails: Set<string>;
};

export function makeAuthPreHandler(deps: AuthDeps) {
  return async function authPreHandler(req: FastifyRequest, _reply: FastifyReply) {
    // Strip query string before matching — `/api/v1/health?probe=1` should
    // still be public.
    const path = req.url.split("?", 1)[0] ?? req.url;
    if (PUBLIC_PATHS.has(path)) return;

    // Token path (machine clients). Tried first so that when both headers
    // are present, the explicit token wins — no surprise where a stray
    // header overrides a deliberately scoped credential.
    const authz = req.headers.authorization;
    if (typeof authz === "string" && authz.startsWith("Bearer ")) {
      const token = authz.slice(7);
      const userId = findActiveUserIdByToken(deps.db, token);
      if (userId === null) {
        throw new ApiError(401, "unauthorized", "Invalid or revoked token");
      }
      req.userId = userId;
      try {
        bumpLastUsed(deps.db, token);
      } catch {
        /* swallow — last_used_at is observability, not load-bearing */
      }
      return;
    }

    // Header path (browser via oauth2-proxy). Gated by ALMANAC_TRUST_PROXY_HEADERS:
    // when the API is exposed without a proxy in front, this path stays off so
    // attackers can't spoof identity via a request header.
    if (deps.trustProxyHeaders) {
      const email = req.headers["x-forwarded-email"];
      if (typeof email === "string" && email.length > 0) {
        req.userId = resolveEmailToUserId(deps.db, email, deps.allowedEmails);
        return;
      }
    }

    throw new ApiError(401, "unauthorized", "No bearer token and no proxy-set email header");
  };
}

function resolveEmailToUserId(db: Connection, email: string, allowedEmails: Set<string>): number {
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;

  if (allowedEmails.size > 0 && !allowedEmails.has(email)) {
    throw new ApiError(403, "forbidden", "Email is not in the allowed users list");
  }

  // The first user to ever sign in owns the instance and is bootstrapped as
  // admin, so a fresh deployment isn't locked out of the admin tooling without
  // a manual DB edit. Only fires on an empty users table → cannot grant admin
  // on an existing deployment.
  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  const isFirstUser = userCount.c === 0 ? 1 : 0;

  try {
    const inserted = db
      .prepare(
        `INSERT INTO users (name, email, timezone, preferred_unit_system, is_admin)
         VALUES (?, ?, 'UTC', 'metric', ?)
         RETURNING id`,
      )
      .get(email.split("@")[0], email, isFirstUser) as { id: number };
    return inserted.id;
  } catch (err) {
    const retry = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
      | { id: number }
      | undefined;
    if (retry) return retry.id;
    throw err;
  }
}
