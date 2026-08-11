import type { Connection } from "@almanac/core/db";
import {
  createCardioSession,
  deleteCardioSession,
  findCardioSessionById,
  listCardioSessions,
  updateCardioSession,
} from "@almanac/core/repos";
import {
  CardioKcalEstimateSchema,
  CardioSessionEnrichedResponseSchema,
  CardioSessionInputSchema,
  CardioSessionUpdateSchema,
  ListCardioSessionsQuerySchema,
} from "@almanac/core/schemas";
import { compareKcalEstimates, computeCardioKcalEstimate } from "@almanac/core/signals";
import { currentUserDate, type EstKcalSource } from "@almanac/core/types";
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
    est_kcal_source: EstKcalSource | null;
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
  // A server-computed est_kcal cannot disagree with the server's own
  // estimate, so warning on it would fire on every session and mean nothing.
  const warning =
    session.est_kcal_source === null || session.est_kcal_source === "user"
      ? compareKcalEstimates(session.est_kcal, estimate.est_kcal_hr)
      : null;
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

/**
 * Derive the burn from heart rate. Null when the session lacks either input,
 * which is the only case where the caller has to supply `est_kcal` itself.
 */
function deriveEstKcal(
  session: { avg_hr?: number | null; duration_min?: number | null; started_at: string },
  user: EnrichmentUser,
  weightKg: number | null,
): { est_kcal: number; est_kcal_source: EstKcalSource } | null {
  const { avg_hr, duration_min } = session;
  if (avg_hr == null || duration_min == null) return null;
  const estimate = computeCardioKcalEstimate({
    avg_hr,
    duration_min,
    user: { dob: user.dob, sex: user.sex, weight_kg: weightKg },
    asOf: session.started_at.slice(0, 10),
  });
  return {
    est_kcal: estimate.est_kcal_hr,
    est_kcal_source:
      estimate.components.mets_basis === "zone_scaled" ? "server_zone" : "server_flat",
  };
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

  // Must stay ahead of `/:id`: that route's params schema would reject the
  // literal segment as a non-integer id.
  app.get(
    "/v1/cardio-sessions/kcal-preview",
    {
      schema: {
        querystring: z.object({
          avg_hr: z.coerce.number().int().positive(),
          duration_min: z.coerce.number().int().positive(),
          on_date: z.string().length(10).optional(),
        }),
        response: { 200: CardioKcalEstimateSchema },
      },
    },
    async (req) => {
      const user = requireUser(app.db, req);
      return computeCardioKcalEstimate({
        avg_hr: req.query.avg_hr,
        duration_min: req.query.duration_min,
        user: { dob: user.dob, sex: user.sex, weight_kg: latestWeightKg(app.db, user.id) },
        // Only feeds the age calculation, so a day either way is harmless.
        asOf: req.query.on_date ?? currentUserDate(new Date(), user.timezone),
      });
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
      const weight = latestWeightKg(app.db, user.id);
      const resolved =
        body.est_kcal === undefined
          ? deriveEstKcal(body, user, weight)
          : { est_kcal: body.est_kcal, est_kcal_source: "user" as const };
      // The schema refinement already rejects this combination; the guard is
      // what proves est_kcal is a number to the repo's input type.
      if (resolved === null) {
        throw new ApiError(
          422,
          "validation_failed",
          "est_kcal is required unless both avg_hr and duration_min are given",
        );
      }
      const created = createCardioSession(app.db, { user_id: user.id, ...body, ...resolved });
      reply.code(201).send(enrichCardio(created, user, weight));
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
      const existing = findCardioSessionById(app.db, user.id, req.params.id);
      if (!existing)
        throw new ApiError(404, "not_found", `Cardio session ${req.params.id} not found`);
      const weight = latestWeightKg(app.db, user.id);
      // A number in the payload is the caller's, whoever owned the old one.
      // Otherwise a server-owned figure follows its inputs; a caller-owned or
      // legacy (null) one is left exactly as the caller last set it.
      const owned = existing.est_kcal_source;
      const claimed = body.est_kcal !== undefined;
      const rederived =
        !claimed && (owned === "server_zone" || owned === "server_flat")
          ? deriveEstKcal({ ...existing, ...body }, user, weight)
          : null;
      const updated = updateCardioSession(app.db, user.id, req.params.id, {
        ...body,
        ...(claimed ? { est_kcal_source: "user" as const } : {}),
        ...(rederived ?? {}),
      });
      if (!updated)
        throw new ApiError(404, "not_found", `Cardio session ${req.params.id} not found`);
      return enrichCardio(updated, user, weight);
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
