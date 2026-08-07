import { z } from "zod";
import {
  DateRangeQuerySchema,
  IdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  TimestampRangeQuerySchema,
} from "./common.js";

// Body weights (upsert; measured_on NOT in UpdateSchema — schema-locked unique key)
export const BodyWeightInputSchema = z
  .object({
    measured_on: IsoDateSchema,
    weight_kg: z.number().positive(),
    notes: z.string().nullish(),
  })
  .strict();
export const BodyWeightUpdateSchema = z
  .object({
    weight_kg: z.number().positive().optional(),
    notes: z.string().nullish(),
  })
  .strict();
export const BodyWeightResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  measured_on: IsoDateSchema,
  weight_kg: z.number(),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});
export const ListBodyWeightsQuerySchema = DateRangeQuerySchema;

// Sleep logs (upsert; slept_on NOT in UpdateSchema)
export const SleepLogInputSchema = z
  .object({
    slept_on: IsoDateSchema,
    hours: z.number().positive(),
    quality: z.number().int().min(1).max(5).nullish(),
    notes: z.string().nullish(),
  })
  .strict();
export const SleepLogUpdateSchema = z
  .object({
    hours: z.number().positive().optional(),
    quality: z.number().int().min(1).max(5).nullish(),
    notes: z.string().nullish(),
  })
  .strict();
export const SleepLogResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  slept_on: IsoDateSchema,
  hours: z.number(),
  quality: z.number().int().nullable(),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});
export const ListSleepLogsQuerySchema = DateRangeQuerySchema;

// Step logs (upsert; on_date NOT in UpdateSchema). steps is positive, not
// nonnegative: a zero-step day is not a thing a person records. A day that
// shouldn't count is an untracked period, and an absent row already means
// "not logged" everywhere downstream.
export const StepLogInputSchema = z
  .object({
    on_date: IsoDateSchema,
    steps: z.number().int().positive(),
    est_kcal: z.number().int().nonnegative().nullish(),
    source: z.enum(["manual", "import"]).optional(),
    notes: z.string().nullish(),
  })
  .strict();
export const StepLogUpdateSchema = z
  .object({
    steps: z.number().int().positive().optional(),
    est_kcal: z.number().int().nonnegative().nullish(),
    notes: z.string().nullish(),
  })
  .strict();
export const StepLogResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  on_date: IsoDateSchema,
  steps: z.number().int(),
  est_kcal: z.number().int().nullable(),
  source: z.enum(["manual", "import"]),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});
export const ListStepLogsQuerySchema = DateRangeQuerySchema;

// Cardio sessions
export const CardioSessionInputSchema = z
  .object({
    started_at: z.string().min(1),
    duration_min: z.number().int().positive().nullish(),
    modality: z.string().nullish(),
    avg_hr: z.number().int().positive().nullish(),
    distance_km: z.number().positive().nullish(),
    steps: z.number().int().nonnegative().nullish(),
    est_kcal: z.number().int().nonnegative(),
    notes: z.string().nullish(),
  })
  .strict();
export const CardioSessionUpdateSchema = z
  .object({
    started_at: z.string().min(1).optional(),
    duration_min: z.number().int().positive().nullish(),
    modality: z.string().nullish(),
    avg_hr: z.number().int().positive().nullish(),
    distance_km: z.number().positive().nullish(),
    steps: z.number().int().nonnegative().nullish(),
    est_kcal: z.number().int().nonnegative().optional(),
    notes: z.string().nullish(),
  })
  .strict();
// Optional enrichment block: HR-derived kcal estimate (midpoint of Keytel
// and METs) and a sanity-check warning when the user's est_kcal disagrees
// with it by >threshold%. Always null when avg_hr or duration_min is
// missing — the formulas need both.
export const CardioKcalEstimateSchema = z.object({
  est_kcal_hr: z.number().int(),
  basis: z.enum(["keytel_and_mets", "mets_only"]),
  components: z.object({
    keytel_kcal: z.number().int().nullable(),
    mets_kcal: z.number().int(),
  }),
});
export const CardioKcalWarningSchema = z.object({
  delta_pct: z.number(),
  user_est_kcal: z.number().int(),
  hr_est_kcal: z.number().int(),
  message: z.string(),
});
// Persistence shape — mirrors the domain `CardioSession` exactly. This is
// what comes out of the repo. Kept in lockstep with the domain type via the
// drift verifier in _verify.test.ts. The HR-derived kcal enrichment lives
// in a separate `CardioSessionEnrichedResponseSchema` below so the
// persistence/view-model split stays clean.
export const CardioSessionResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  started_at: IsoDateTimeSchema,
  duration_min: z.number().int().nullable(),
  modality: z.string().nullable(),
  avg_hr: z.number().int().nullable(),
  distance_km: z.number().nullable(),
  steps: z.number().int().nullable(),
  est_kcal: z.number().int(),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});

// API response shape — extends the persistence shape with the HR-derived
// enrichment fields. The API routes use this; the persistence schema above
// stays drift-checked against the domain type.
export const CardioSessionEnrichedResponseSchema = CardioSessionResponseSchema.extend({
  /**
   * HR-derived kcal estimate (midpoint of Keytel and METs). Null when
   * avg_hr or duration_min is missing — those are the only inputs the
   * formulas need that aren't on the user profile.
   */
  kcal_estimate: CardioKcalEstimateSchema.nullable(),
  /**
   * Sanity-check delta between the user-logged `est_kcal` and the
   * `kcal_estimate.est_kcal_hr`. Null when within tolerance (default
   * ±20%) or when one input is missing. The AI consumer can surface
   * the message verbatim or use the structured fields.
   */
  estimate_warning: CardioKcalWarningSchema.nullable(),
});
export const ListCardioSessionsQuerySchema = TimestampRangeQuerySchema;

// Alcohol sessions
export const AlcoholSessionInputSchema = z
  .object({
    started_at: z.string().min(1),
    ended_at: z.string().min(1).nullish(),
    drinks_count: z.number().positive(),
    est_kcal: z.number().int().nonnegative(),
    notes: z.string().nullish(),
  })
  .strict();
export const AlcoholSessionUpdateSchema = z
  .object({
    started_at: z.string().min(1).optional(),
    ended_at: z.string().min(1).nullish(),
    drinks_count: z.number().positive().optional(),
    est_kcal: z.number().int().nonnegative().optional(),
    notes: z.string().nullish(),
  })
  .strict();
export const AlcoholSessionResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  started_at: IsoDateTimeSchema,
  ended_at: IsoDateTimeSchema.nullable(),
  drinks_count: z.number(),
  est_kcal: z.number().int(),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});
export const ListAlcoholSessionsQuerySchema = TimestampRangeQuerySchema;
