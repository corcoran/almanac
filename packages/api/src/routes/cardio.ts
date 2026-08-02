import type { Connection } from "@almanac/core/db";
import {
  createCardioSession,
  deleteCardioSession,
  findCardioSessionById,
  listCardioSessions,
  updateCardioSession,
} from "@almanac/core/repos";
import {
  CardioSessionEnrichedResponseSchema,
  CardioSessionInputSchema,
  CardioSessionUpdateSchema,
  ListCardioSessionsQuerySchema,
} from "@almanac/core/schemas";
import { compareKcalEstimates, computeCardioKcalEstimate } from "@almanac/core/signals";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema, normalizeTimestamp, resolveDateRange } from "../params.js";

/**
 * Enrich a cardio session with the HR-derived kcal estimate and the
 * sanity-check warning (if any). Returns a new object — does not mutate.
 *
 * `kcal_estimate` and `estimate_warning` are both null when the session
 * lacks the inputs needed (avg_hr + duration_min), so consumers always see
 * the keys present in the schema even on incomplete records.
 *
 * The latest body weight is looked up here (rather than passed in) because
 * the list endpoint enriches an array and a per-call lookup would N+1.
 * Caller passes the pre-fetched weight in for the list path; the single-
 * session paths fetch inline.
 */
type EnrichmentUser = {
  dob: string | null;
  sex: "male" | "female" | null;
};
function enrichCardio<
  T extends {
    avg_hr: number | null;
    duration_min: number | null;
    est_kcal: number;
    started_at: string;
  },
>(
  session: T,
  user: EnrichmentUser,
  latestWeightKg: number | null,
): T & {
  kcal_estimate: ReturnType<typeof computeCardioKcalEstimate> | null;
  estimate_warning: ReturnType<typeof compareKcalEstimates>;
} {
  if (session.avg_hr === null || session.duration_min === null) {
    return { ...session, kcal_estimate: null, estimate_warning: null };
  }
  const asOf = session.started_at.slice(0, 10);
  const estimate = computeCardioKcalEstimate({
    avg_hr: session.avg_hr,
    duration_min: session.duration_min,
    user: { dob: user.dob, sex: user.sex, weight_kg: latestWeightKg },
    asOf,
  });
  const warning = compareKcalEstimates(session.est_kcal, estimate.est_kcal_hr);
  return { ...session, kcal_estimate: estimate, estimate_warning: warning };
}

/** Pull the latest body-weight reading once, for list enrichment. */
function latestWeightKg(db: Connection, userId: number): number | null {
  const row = db
    .prepare(
      `SELECT weight_kg FROM body_weights
       WHERE user_id = ?
       ORDER BY measured_on DESC LIMIT 1`,
    )
    .get(userId) as { weight_kg: number } | undefined;
  return row?.weight_kg ?? null;
}

export const registerCardioRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/cardio-sessions",
    {
      schema: {
        querystring: ListCardioSessionsQuerySchema,
        response: { 200: z.array(CardioSessionEnrichedResponseSchema) },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      const range = resolveDateRange(req.query, user);
      const sessions = listCardioSessions(app.db, user.id, { ...range, limit: req.query.limit });
      const weight = latestWeightKg(app.db, user.id);
      return sessions.map((s) => enrichCardio(s, user, weight));
    },
  );

  app.get(
    "/v1/cardio-sessions/:id",
    { schema: { params: IdParamsSchema, response: { 200: CardioSessionEnrichedResponseSchema } } },
    async (req) => {
      const user = requireUser(app.db, req);
      const found = findCardioSessionById(app.db, user.id, req.params.id);
      if (!found) throw new ApiError(404, "not_found", `Cardio session ${req.params.id} not found`);
      return enrichCardio(found, user, latestWeightKg(app.db, user.id));
    },
  );

  app.post(
    "/v1/cardio-sessions",
    {
      config: { idempotent: true },
      schema: {
        body: CardioSessionInputSchema,
        response: { 201: CardioSessionEnrichedResponseSchema },
      },
    },
    async (req, reply) => {
      const user = requireUser(app.db, req);
      const body = normalizeTimestamp(req.body, "started_at", user.timezone);
      const created = createCardioSession(app.db, { user_id: user.id, ...body });
      reply.code(201).send(enrichCardio(created, user, latestWeightKg(app.db, user.id)));
    },
  );

  app.patch(
    "/v1/cardio-sessions/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: CardioSessionUpdateSchema,
        response: { 200: CardioSessionEnrichedResponseSchema },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      const body = normalizeTimestamp(req.body, "started_at", user.timezone);
      const updated = updateCardioSession(app.db, user.id, req.params.id, body);
      if (!updated)
        throw new ApiError(404, "not_found", `Cardio session ${req.params.id} not found`);
      return enrichCardio(updated, user, latestWeightKg(app.db, user.id));
    },
  );

  app.delete(
    "/v1/cardio-sessions/:id",
    { schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const user = requireUser(app.db, req);
      deleteCardioSession(app.db, user.id, req.params.id);
      reply.code(204).send();
    },
  );
};
