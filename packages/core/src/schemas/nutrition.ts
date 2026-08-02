import { z } from "zod";
import { IdSchema, IsoDateSchema, IsoDateTimeSchema, TimestampRangeQuerySchema } from "./common.js";

/** Legacy phase intent — retains `recomp` for backward compatibility with
 *  pre-refactor phases. New phases use {@link PhaseTypeSchema}. */
export const PhaseIntentSchema = z.enum(["cut", "bulk", "recomp", "maintenance"]);

/** Narrow phase type for the v1 TDEE refactor (no `recomp`). Nullable on
 *  historical phases that predate migration 006. */
export const PhaseTypeSchema = z.enum(["cut", "bulk", "maintenance"]);

/** Provenance for `tdee_at_phase_start`. Null on historical phases. */
export const TdeeSourceSchema = z.enum(["formula", "measured", "user_asserted"]);

/**
 * Repo-level start-phase input shape. The HTTP route accepts a different
 * (more ergonomic) shape with `tdee_override` and either `deficit_kcal` or
 * `daily_kcal_target`; the route resolves those into the four fields below
 * before calling `closeAndStartPhase`.
 */
export const StartPhaseInputSchema = z
  .object({
    name: z.string().min(1),
    intent: PhaseIntentSchema,
    phase_type: PhaseTypeSchema,
    tdee_at_phase_start: z.number().int().positive(),
    tdee_source: TdeeSourceSchema,
    deficit_kcal: z.number().int(),
    daily_kcal_target: z.number().int().positive(),
    base_protein_g: z.number().int().nonnegative(),
    base_carb_g: z.number().int().nonnegative(),
    base_fat_g: z.number().int().nonnegative(),
    started_on: IsoDateSchema,
    planned_end_on: IsoDateSchema.optional(),
    notes: z.string().nullish(),
  })
  .strict();

export const NutritionPhaseUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    intent: PhaseIntentSchema.optional(),
    phase_type: PhaseTypeSchema.optional(),
    tdee_at_phase_start: z.number().int().positive().optional(),
    tdee_source: TdeeSourceSchema.optional(),
    deficit_kcal: z.number().int().optional(),
    daily_kcal_target: z.number().int().positive().optional(),
    base_protein_g: z.number().int().nonnegative().optional(),
    base_carb_g: z.number().int().nonnegative().optional(),
    base_fat_g: z.number().int().nonnegative().optional(),
    started_on: IsoDateSchema.optional(),
    planned_end_on: IsoDateSchema.nullish(),
    ended_on: IsoDateSchema.nullish(),
    notes: z.string().nullish(),
  })
  .strict();

/**
 * Response wrapper for a stored nutrition phase. The four TDEE refactor
 * fields (`phase_type`, `tdee_at_phase_start`, `tdee_source`, `deficit_kcal`)
 * are nullable — historical phases created before migration 006 do not have
 * them populated. Active and newly-created phases always do.
 */
export const NutritionPhaseResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  name: z.string(),
  intent: PhaseIntentSchema,
  phase_type: PhaseTypeSchema.nullable(),
  tdee_at_phase_start: z.number().int().nullable(),
  tdee_source: TdeeSourceSchema.nullable(),
  deficit_kcal: z.number().int().nullable(),
  daily_kcal_target: z.number().int(),
  base_protein_g: z.number().int(),
  base_carb_g: z.number().int(),
  base_fat_g: z.number().int(),
  started_on: IsoDateSchema,
  planned_end_on: IsoDateSchema.nullable(),
  ended_on: IsoDateSchema.nullable(),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});

export const MealInputSchema = z
  .object({
    eaten_at: z.string().min(1),
    name: z.string().nullish(),
    kcal: z.number().int().nonnegative(),
    protein_g: z.number().nonnegative(),
    carb_g: z.number().nonnegative(),
    fat_g: z.number().nonnegative(),
    notes: z.string().nullish(),
  })
  .strict();

export const MealUpdateSchema = z
  .object({
    eaten_at: z.string().min(1).optional(),
    name: z.string().nullish(),
    kcal: z.number().int().nonnegative().optional(),
    protein_g: z.number().nonnegative().optional(),
    carb_g: z.number().nonnegative().optional(),
    fat_g: z.number().nonnegative().optional(),
    notes: z.string().nullish(),
  })
  .strict();

export const MealResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  eaten_at: IsoDateTimeSchema,
  name: z.string().nullable(),
  kcal: z.number().int(),
  protein_g: z.number(),
  carb_g: z.number(),
  fat_g: z.number(),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});

export const ListMealsQuerySchema = TimestampRangeQuerySchema;

export const StoredMealInputSchema = z
  .object({
    name: z.string().min(1),
    kcal: z.number().int().nonnegative(),
    protein_g: z.number().nonnegative(),
    carb_g: z.number().nonnegative(),
    fat_g: z.number().nonnegative(),
    description: z.string().nullish(),
  })
  .strict();

export const StoredMealUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    kcal: z.number().int().nonnegative().optional(),
    protein_g: z.number().nonnegative().optional(),
    carb_g: z.number().nonnegative().optional(),
    fat_g: z.number().nonnegative().optional(),
    description: z.string().nullish(),
  })
  .strict();

export const StoredMealResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  name: z.string(),
  kcal: z.number().int(),
  protein_g: z.number(),
  carb_g: z.number(),
  fat_g: z.number(),
  description: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});

/**
 * Per spec §"start_nutrition_phase error contract for incomplete profiles":
 * Structured 422 envelope when TDEE cannot be resolved (no body weight logged
 * and no tdee_override provided). Allows AI consumers to surface missing
 * prerequisites and guide the user toward re-calling with an override.
 */
export const TdeeUnavailableErrorSchema = z.object({
  error: z.literal("tdee_unavailable"),
  reason: z.literal("no_measured_tdee_yet"),
  required_action: z.literal("provide_tdee_override"),
  hints: z.object({
    missing_profile_fields: z.array(z.string()),
    suggestion: z.string(),
  }),
});

export type TdeeUnavailableError = z.infer<typeof TdeeUnavailableErrorSchema>;
