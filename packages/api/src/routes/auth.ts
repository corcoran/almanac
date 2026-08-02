import type { LlmConfig } from "@almanac/core/llm";
import { findUserById, listActiveForUser, mintToken, revokeToken } from "@almanac/core/repos";
import { TokenSummarySchema, WhoamiResponseSchema } from "@almanac/core/schemas";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";

/**
 * Server-side LLM availability for whoami: the master switch is on AND a
 * provider key is configured. The per-user `llm_logging_enabled` flag is the
 * other half of the gate (see `assertLlmEnabled`); the web UI shows the AI
 * surface only when BOTH this and the per-user flag hold.
 */
function llmAvailable(cfg: Pick<LlmConfig, "enabled" | "apiKey">): boolean {
  return cfg.enabled && Boolean(cfg.apiKey);
}

/**
 * User-facing auth surface. Tokens are cleartext-once on mint and never
 * returned again — `listActiveForUser` deliberately omits `token_hash`,
 * and the list endpoint's response schema strips any field that isn't
 * declared. Revoke is intentionally idempotent and never 404s, even when
 * the id belongs to a different user, so the response can't be used as
 * an oracle for "does this token id exist?".
 *
 * Response schemas (`WhoamiResponseSchema`, `TokenSummarySchema`) are
 * defined in `@almanac/core/schemas` so the web package can `z.infer<>`
 * them for its auth store without duplicating the shape. Request-only
 * schemas (`CreateTokenInput`, `CreateTokenResponse`, `IdParams`) stay
 * local — nothing else consumes them.
 */
const CreateTokenInput = z.object({ name: z.string().min(1).max(100) }).strict();
const CreateTokenResponse = TokenSummarySchema.extend({ token: z.string() });

const IdParams = z.object({ id: z.coerce.number().int().positive() }).strict();

/**
 * Auth routes factory. Closes over the LLM config so whoami can report
 * server-side `llm_available` (master switch + key present) — the web UI needs
 * this to hide the AI surface when the server can't serve LLM, even for a
 * per-user-flagged user.
 */
export function makeAuthRoutes(
  llmConfig: Pick<LlmConfig, "enabled" | "apiKey">,
): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/v1/auth/whoami",
      { schema: { response: { 200: WhoamiResponseSchema } } },
      async (req) => {
        const user = findUserById(app.db, requireUserId(req));
        if (!user) throw new ApiError(404, "not_found", "User not found");
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          preferred_unit_system: user.preferred_unit_system,
          timezone: user.timezone,
          llm_logging_enabled: user.llm_logging_enabled,
          llm_available: llmAvailable(llmConfig),
        };
      },
    );

    app.get(
      "/v1/auth/tokens",
      { schema: { response: { 200: z.array(TokenSummarySchema) } } },
      async (req) => listActiveForUser(app.db, requireUserId(req)),
    );

    app.post(
      "/v1/auth/tokens",
      { schema: { body: CreateTokenInput, response: { 201: CreateTokenResponse } } },
      async (req, reply) => {
        const { token, record } = mintToken(app.db, {
          user_id: requireUserId(req),
          name: req.body.name,
        });
        reply.code(201).send({ ...record, token });
      },
    );

    app.delete("/v1/auth/tokens/:id", { schema: { params: IdParams } }, async (req, reply) => {
      // Idempotent — 204 whether or not the row was active (or even existed,
      // or belonged to a different user). Never leak existence of others'
      // token ids through the status code.
      revokeToken(app.db, req.params.id, requireUserId(req));
      reply.code(204).send();
    });
  };
}
