import {
  closeAndStartPhase,
  deletePhase,
  findActivePhase,
  findPhaseById,
  type findUserById,
  getUntrackedDays,
  listPhases,
  updatePhase,
} from "@almanac/core/repos";
import {
  ErrorBodySchema,
  NutritionPhaseResponseSchema,
  NutritionPhaseUpdateSchema,
  PhaseEstimateQuerySchema,
  PhaseEstimateResponseSchema,
  PhaseIntentSchema,
  PhaseTypeSchema,
  TdeeUnavailableErrorSchema,
} from "@almanac/core/schemas";
import {
  computeTDEE,
  MAINTENANCE_BAND_PCT,
  persistNewAccomplishments,
  suggestMacros,
} from "@almanac/core/signals";
import type { PhaseType, TdeeSource, User } from "@almanac/core/types";
import { currentUserDate } from "@almanac/core/types";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser, requireUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { IdParamsSchema } from "../params.js";

/**
 * New TDEE-refactor request body. Either `deficit_kcal` or `daily_kcal_target`
 * must be supplied; the route derives the other from the resolved TDEE
 * snapshot. `tdee_override` short-circuits computeTDEE (with
 * `tdee_source: 'user_asserted'`) — without it, the route falls back to
 * `computeTDEE` and snapshots whatever it returns with its `source`. If
 * computeTDEE can't produce a usable value (no weight yet logged), the route
 * fails with a structured 422 `tdee_unavailable` error so an AI consumer can
 * surface the missing prerequisites and re-call with an override.
 */
const StartPhaseRequestSchema = z
  .object({
    name: z.string().min(1),
    intent: PhaseIntentSchema,
    phase_type: PhaseTypeSchema,
    deficit_kcal: z.number().int().optional(),
    daily_kcal_target: z.number().int().positive().optional(),
    tdee_override: z.number().int().positive().optional(),
    base_protein_g: z.number().int().nonnegative(),
    base_carb_g: z.number().int().nonnegative(),
    base_fat_g: z.number().int().nonnegative(),
    started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    planned_end_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    notes: z.string().nullish(),
  })
  .strict()
  .refine((d) => d.deficit_kcal != null || d.daily_kcal_target != null, {
    message: "Must provide deficit_kcal or daily_kcal_target",
  });

/**
 * Phase-type/deficit invariant per spec §"Validation invariant":
 *  - cut          → deficit_kcal < 0 AND |deficit_kcal| > 5% of TDEE
 *  - bulk         → deficit_kcal > 0 AND deficit_kcal > 5% of TDEE
 *  - maintenance  → |deficit_kcal| ≤ 5% of TDEE
 * Throws on violation; the handler maps to a 400.
 */
function validatePhaseInvariant(phase_type: PhaseType, deficit_kcal: number, tdee: number): void {
  const bandKcal = tdee * MAINTENANCE_BAND_PCT;
  switch (phase_type) {
    case "cut":
      if (deficit_kcal >= 0 || Math.abs(deficit_kcal) <= bandKcal) {
        throw new ApiError(
          400,
          "validation_failed",
          `cut requires deficit_kcal < -${Math.round(bandKcal)} (5% of TDEE ${tdee})`,
        );
      }
      return;
    case "bulk":
      if (deficit_kcal <= 0 || deficit_kcal <= bandKcal) {
        throw new ApiError(
          400,
          "validation_failed",
          `bulk requires deficit_kcal > +${Math.round(bandKcal)} (5% of TDEE ${tdee})`,
        );
      }
      return;
    case "maintenance":
      if (Math.abs(deficit_kcal) > bandKcal) {
        throw new ApiError(
          400,
          "validation_failed",
          `maintenance requires |deficit_kcal| <= ${Math.round(bandKcal)} (5% of TDEE ${tdee})`,
        );
      }
      return;
  }
}

/**
 * Per spec §"start_nutrition_phase error contract for incomplete profiles":
 * minimal hint list for `tdee_unavailable`. Spec 1 only requires `weight_kg`
 * — height/sex/dob are not required until the Mifflin formula path lands in
 * Spec 2. The check is "has the user ever logged a body weight" (matches
 * `profile_complete` semantics in getTodayContext).
 */
function getMissingProfileFields(hasAnyBodyWeight: boolean): string[] {
  return hasAnyBodyWeight ? [] : ["weight_kg"];
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const registerNutritionPhasesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/nutrition-phases",
    { schema: { response: { 200: z.array(NutritionPhaseResponseSchema) } } },
    async (req) => {
      const userId = requireUserId(req);
      return listPhases(app.db, userId);
    },
  );

  app.get(
    "/v1/nutrition-phases/active",
    { schema: { response: { 200: NutritionPhaseResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      const phase = findActivePhase(app.db, userId);
      if (!phase) throw new ApiError(404, "not_found", "No active nutrition phase");
      return phase;
    },
  );

  app.get(
    "/v1/nutrition-phases/:id",
    { schema: { params: IdParamsSchema, response: { 200: NutritionPhaseResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      const found = findPhaseById(app.db, userId, req.params.id);
      if (!found) throw new ApiError(404, "not_found", `Phase ${req.params.id} not found`);
      return found;
    },
  );

  app.get(
    "/v1/phase-estimate",
    {
      schema: {
        querystring: PhaseEstimateQuerySchema,
        response: { 200: PhaseEstimateResponseSchema },
      },
    },
    async (req, reply) => {
      const user = requireUser(app.db, req);
      const q = req.query;
      const today = currentUserDate(new Date(), user.timezone);
      const asOf = addDaysIso(today, -1);

      const bodyWeights = app.db
        .prepare(
          `SELECT measured_on, weight_kg FROM body_weights
           WHERE user_id = ? AND measured_on >= ? AND measured_on <= ?
           ORDER BY measured_on`,
        )
        .all(user.id, addDaysIso(asOf, -60), asOf) as Array<{
        measured_on: string;
        weight_kg: number;
      }>;
      // A previewed weight (the create form's typed, not-yet-logged value) lets
      // the cold-start user see a weight-anchored estimate + macro suggestion
      // before the weigh-in is saved. A real DB weigh-in still takes precedence.
      const hasWeight = bodyWeights.length > 0 || q.weight_kg != null;

      const meals = app.db
        .prepare(
          `SELECT eaten_at, kcal FROM meals WHERE user_id = ? AND date(eaten_at) >= ? AND date(eaten_at) <= ?`,
        )
        .all(user.id, addDaysIso(asOf, -30), asOf) as Array<{ eaten_at: string; kcal: number }>;
      const alcoholSessions = app.db
        .prepare(
          `SELECT started_at, est_kcal FROM alcohol_sessions WHERE user_id = ? AND date(started_at) >= ? AND date(started_at) <= ?`,
        )
        .all(user.id, addDaysIso(asOf, -30), asOf) as Array<{
        started_at: string;
        est_kcal: number;
      }>;

      // Prefer a real logged weight; fall back to the previewed one from the
      // form so the estimate reflects the weight the user just entered.
      const latestWeightKg = bodyWeights[bodyWeights.length - 1]?.weight_kg ?? q.weight_kg ?? null;
      const tdee = computeTDEE({
        asOf,
        tz: user.timezone,
        bodyWeights,
        meals,
        alcoholSessions,
        user: {
          // Each profile field can be PREVIEWED from the query (the create form
          // passes whatever the user has typed) so the Mifflin estimate reflects
          // their real height/age/sex live; fall back to the stored profile when
          // not previewed. None of this persists.
          dob: q.dob ?? user.dob,
          height_cm: q.height_cm ?? user.height_cm,
          sex: q.sex ?? user.sex,
          latestWeightKg,
          activity_level: q.activity ?? user.activity_level,
        },
        untrackedDays: getUntrackedDays(app.db, user.id, addDaysIso(asOf, -60), asOf),
      });

      // Macros anchor protein to bodyweight, so a suggestion is only honest
      // once a real weight exists. With no weigh-in we'd be fabricating a
      // protein target from a default body — return null and let the form
      // collect the weight first (the cold-start flow logs one before asking
      // for macros). So gate on latestWeightKg, not just the query params.
      const suggested_macros =
        latestWeightKg != null && q.target_kcal != null && q.phase_type != null
          ? suggestMacros({
              weightKg: latestWeightKg,
              targetKcal: q.target_kcal,
              phaseType: q.phase_type,
            })
          : null;

      return reply.code(200).send({
        tdee: tdee.kcal,
        basis: tdee.basis,
        source: tdee.source,
        has_weight: hasWeight,
        suggested_macros,
      });
    },
  );

  app.post(
    "/v1/nutrition-phases",
    {
      schema: {
        body: StartPhaseRequestSchema,
        // 201 emits the stored phase shape. 422 carries two shapes: the
        // `tdee_unavailable` envelope this handler sends directly, and the
        // generic `validation_failed` envelope the error handler emits for
        // bad input (body validation + the deficit/target refine). The union
        // lets the typed reply accept the former while keeping the latter
        // serializable, so no `(reply as any)` cast is needed.
        response: {
          201: NutritionPhaseResponseSchema,
          422: z.union([TdeeUnavailableErrorSchema, ErrorBodySchema]),
        },
      },
    },
    async (req, reply) => {
      const user = requireUser(app.db, req);
      const body = req.body;

      // ---- 1. Resolve TDEE ------------------------------------------------
      let tdee_value: number;
      let tdee_source: TdeeSource;
      if (body.tdee_override != null) {
        tdee_value = body.tdee_override;
        tdee_source = "user_asserted";
      } else {
        const resolved = resolveTdeeFromDb(app.db, user);
        if (!resolved) {
          const hasAnyBodyWeight =
            (app.db
              .prepare("SELECT 1 FROM body_weights WHERE user_id = ? LIMIT 1")
              .get(user.id) as unknown) != null;
          // Structured error envelope per spec §"start_nutrition_phase error
          // contract for incomplete profiles". The envelope shape is declared in
          // TdeeUnavailableErrorSchema and validated here to ensure the contract
          // is maintained (so the MCP layer can rely on the exact shape). The
          // route's 422 response schema is a union that includes this envelope,
          // so the typed reply accepts it without a cast.
          const envelope = TdeeUnavailableErrorSchema.parse({
            error: "tdee_unavailable",
            reason: "no_measured_tdee_yet",
            required_action: "provide_tdee_override",
            hints: {
              missing_profile_fields: getMissingProfileFields(hasAnyBodyWeight),
              suggestion:
                "Discuss the user's stats, activity level, and goals to land on a TDEE estimate, then call start_nutrition_phase with tdee_override set.",
            },
          });
          return reply.code(422).send(envelope);
        }
        tdee_value = resolved.tdee;
        tdee_source = resolved.source;
      }

      // ---- 2. Derive deficit_kcal / daily_kcal_target --------------------
      // Spec: if only one is provided, derive the other from the TDEE
      // snapshot. If both are provided, trust the caller (no consistency
      // check — the invariant check below catches sign mismatches).
      const daily_kcal_target =
        body.daily_kcal_target ?? tdee_value + (body.deficit_kcal as number);
      const deficit_kcal = body.deficit_kcal ?? (body.daily_kcal_target as number) - tdee_value;

      // ---- 3. Validate phase_type vs deficit sign + magnitude -----------
      validatePhaseInvariant(body.phase_type, deficit_kcal, tdee_value);

      // ---- 3a. Consistency check when both deficit_kcal and target supplied
      if (
        body.deficit_kcal != null &&
        body.daily_kcal_target != null &&
        tdee_value + body.deficit_kcal !== body.daily_kcal_target
      ) {
        throw new ApiError(
          400,
          "validation_failed",
          `Inconsistent inputs: tdee (${tdee_value}) + deficit_kcal (${body.deficit_kcal}) = ${
            tdee_value + body.deficit_kcal
          }, but daily_kcal_target = ${body.daily_kcal_target}. Provide only one of deficit_kcal/daily_kcal_target, or ensure they match.`,
        );
      }

      // ---- 4. Persist -----------------------------------------------------
      const created = closeAndStartPhase(app.db, {
        user_id: user.id,
        name: body.name,
        intent: body.intent,
        phase_type: body.phase_type,
        tdee_at_phase_start: tdee_value,
        tdee_source,
        deficit_kcal,
        daily_kcal_target,
        base_protein_g: body.base_protein_g,
        base_carb_g: body.base_carb_g,
        base_fat_g: body.base_fat_g,
        started_on: body.started_on,
        planned_end_on: body.planned_end_on,
        notes: body.notes,
      });
      persistNewAccomplishments(app.db, user.id);
      return reply.code(201).send(created);
    },
  );

  app.patch(
    "/v1/nutrition-phases/:id",
    {
      schema: {
        params: IdParamsSchema,
        body: NutritionPhaseUpdateSchema,
        response: { 200: NutritionPhaseResponseSchema },
      },
    },
    async (req) => {
      const userId = requireUserId(req);
      const updated = updatePhase(app.db, userId, req.params.id, req.body);
      if (!updated) throw new ApiError(404, "not_found", `Phase ${req.params.id} not found`);
      persistNewAccomplishments(app.db, userId);
      return updated;
    },
  );

  app.delete(
    "/v1/nutrition-phases/:id",
    { schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const userId = requireUserId(req);
      deletePhase(app.db, userId, req.params.id);
      reply.code(204).send();
    },
  );
};

/**
 * Pull all the inputs computeTDEE needs and run it. Returns null when no
 * body weight has ever been logged — without one, both basis branches
 * (Mifflin profile_baseline and measured back-calc) degrade to fabricating
 * a number. We'd rather return null and let the handler surface the
 * `tdee_unavailable` error than silently snapshot a wrong TDEE that locks
 * in the wrong target for the entire phase.
 */
function resolveTdeeFromDb(
  db: Parameters<typeof findUserById>[0],
  user: User,
): { tdee: number; source: TdeeSource } | null {
  const today = currentUserDate(new Date(), user.timezone);
  const asOf = addDaysIso(today, -1);
  const bodyWeights = db
    .prepare(
      `SELECT measured_on, weight_kg FROM body_weights
       WHERE user_id = ? AND measured_on >= ? AND measured_on <= ?
       ORDER BY measured_on`,
    )
    .all(user.id, addDaysIso(asOf, -60), asOf) as Array<{
    measured_on: string;
    weight_kg: number;
  }>;
  if (bodyWeights.length === 0) {
    // No weights at all → no usable TDEE. Spec 1 requires at least one
    // weight to be logged before a phase can be opened without override.
    return null;
  }

  const meals = db
    .prepare(
      `SELECT eaten_at, kcal FROM meals
       WHERE user_id = ? AND date(eaten_at) >= ? AND date(eaten_at) <= ?`,
    )
    .all(user.id, addDaysIso(asOf, -30), asOf) as Array<{
    eaten_at: string;
    kcal: number;
  }>;
  const alcoholSessions = db
    .prepare(
      `SELECT started_at, est_kcal FROM alcohol_sessions
       WHERE user_id = ? AND date(started_at) >= ? AND date(started_at) <= ?`,
    )
    .all(user.id, addDaysIso(asOf, -30), asOf) as Array<{
    started_at: string;
    est_kcal: number;
  }>;
  const tdee = computeTDEE({
    asOf,
    tz: user.timezone,
    bodyWeights,
    meals,
    alcoholSessions,
    user: {
      dob: user.dob,
      height_cm: user.height_cm,
      sex: user.sex,
      activity_level: user.activity_level,
      latestWeightKg: bodyWeights[bodyWeights.length - 1]?.weight_kg ?? null,
    },
    // Honor untracked periods so vacation days don't skew the phase-start snapshot.
    untrackedDays: getUntrackedDays(db, user.id, addDaysIso(asOf, -60), asOf),
  });
  return { tdee: tdee.kcal, source: tdee.source };
}
