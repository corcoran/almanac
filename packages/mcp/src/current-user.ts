import type { ApiClient } from "./client.js";

/**
 * Lazy, cached lookup of the active user's id, scoped to a single MCP
 * connection (the bearer flows in via `getToken`). One per-connection cache
 * is the right granularity: a given bearer maps to exactly one user, and
 * /api/v1/users/me is the canonical resolver. Multi-user deploys end up with one
 * resolver per SSE connection, each closed over its own bearer.
 *
 * Cached on first call. Throws if the API returns no current user (e.g., the
 * bearer is invalid, or auto-provisioning isn't wired and the system isn't
 * bootstrapped yet).
 */
export function makeCurrentUserId(api: ApiClient, getToken: () => string): () => Promise<number> {
  let cached: number | undefined;
  return async () => {
    if (cached !== undefined) return cached;
    const user = await api.request<{ id: number }>("GET", "/api/v1/users/me", undefined, {
      bearer: getToken(),
    });
    cached = user.id;
    return cached;
  };
}
