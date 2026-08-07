import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";

const SetInputSchema = z.object({
  reps: z.number().int().nonnegative(),
  weight_kg: z.number().nullish(),
  notes: z.string().nullish(),
});
const CompactSetsSchema = z.object({
  count: z.number().int().positive(),
  reps: z.number().int().nonnegative(),
  weight_kg: z.number().nullish(),
});
export const SetsShapeSchema = z.union([z.array(SetInputSchema), CompactSetsSchema]);

const ExerciseInstanceInputSchema = z.object({
  exercise_id: IdSchema,
  display_order: z.number().int().nonnegative(),
  planned_sets: z.number().int().nonnegative(),
  notes: z.string().nullish(),
  sets: SetsShapeSchema,
});

const FullWorkoutShape = z.object({
  template_id: IdSchema.nullish(),
  started_at: z.string().min(1),
  duration_min: z.number().int().positive().nullish(),
  rpe: z.number().min(1).max(10),
  est_kcal: z.number().int().nonnegative().nullish(),
  notes: z.string().nullish(),
  exercises: z.array(ExerciseInstanceInputSchema),
});

// `display_order` on `add` deviations is optional — the resolver auto-assigns
// max+1 when omitted.
const DeviationSkipSchema = z.object({
  op: z.literal("skip"),
  exercise_id: IdSchema,
});
const DeviationOverrideSchema = z.object({
  op: z.literal("override_sets"),
  exercise_id: IdSchema,
  sets: SetsShapeSchema,
  planned_sets: z.number().int().nonnegative().optional(),
});
const DeviationAddSchema = z.object({
  op: z.literal("add"),
  exercise_id: IdSchema,
  display_order: z.number().int().nonnegative().optional(),
  planned_sets: z.number().int().nonnegative(),
  sets: SetsShapeSchema,
});
export const DeviationSchema = z.discriminatedUnion("op", [
  DeviationSkipSchema,
  DeviationOverrideSchema,
  DeviationAddSchema,
]);

// `deviations` defaults to `[]` so `{ template_id, started_at, rpe }` alone
// is a valid request — "log the template as written, no divergences." The
// resolver in workouts.repo handles an empty deviations array as a no-op,
// producing the template's items verbatim.
const FromTemplateShape = z.object({
  template_id: IdSchema,
  started_at: z.string().min(1),
  duration_min: z.number().int().positive().nullish(),
  rpe: z.number().min(1).max(10),
  est_kcal: z.number().int().nonnegative().nullish(),
  notes: z.string().nullish(),
  deviations: z.array(DeviationSchema).default([]),
});

/** The two-shape POST per spec §6.3. The resolver in workouts.repo decides based on presence of `deviations`. */
export const CreateWorkoutBodySchema = z.union([FullWorkoutShape, FromTemplateShape]);

export const WorkoutUpdateSchema = z
  .object({
    template_id: IdSchema.nullish(),
    started_at: z.string().min(1).optional(),
    duration_min: z.number().int().positive().nullish(),
    rpe: z.number().min(1).max(10).optional(),
    est_kcal: z.number().int().nonnegative().nullish(),
    notes: z.string().nullish(),
  })
  .strict();

export const SetUpdateSchema = z
  .object({
    reps: z.number().int().nonnegative().optional(),
    weight_kg: z.number().nullish(),
    notes: z.string().nullish(),
  })
  .strict();

// Response shapes mirror the domain types from @almanac/core/types.
const SetResponseSchema = z.object({
  id: IdSchema,
  exercise_instance_id: IdSchema,
  set_number: z.number().int().positive(),
  reps: z.number().int().nonnegative(),
  weight_kg: z.number().nullable(),
  notes: z.string().nullable(),
});
const ExerciseInstanceResponseSchema = z.object({
  id: IdSchema,
  workout_id: IdSchema,
  exercise_id: IdSchema,
  display_order: z.number().int().nonnegative(),
  planned_sets: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  /**
   * ISO timestamp present when this row was logged as a `skip` deviation
   * against the template. Distinct from `sets: []` with `skipped_at: null`,
   * which means "tried it, got zero reps" (the bombed-it case).
   */
  skipped_at: z.string().nullable(),
  sets: z.array(SetResponseSchema).optional(),
});
export const WorkoutResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  template_id: IdSchema.nullable(),
  started_at: IsoDateTimeSchema,
  duration_min: z.number().int().nullable(),
  rpe: z.number(),
  est_kcal: z.number().int().nullable(),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
  exercises: z.array(ExerciseInstanceResponseSchema).optional(),
});

export const ListWorkoutsQuerySchema = z
  .object({
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
    template_id: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(0).max(200).optional(),
  })
  .strict();

export const AddExerciseInstanceBodySchema = ExerciseInstanceInputSchema;
