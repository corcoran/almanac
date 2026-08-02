import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";

// Exercise groups
export const ExerciseGroupResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  name: z.string(),
  display_order: z.number().int().nonnegative(),
  created_at: IsoDateTimeSchema,
});
export const ExerciseGroupInputSchema = z
  .object({
    name: z.string().min(1),
    display_order: z.number().int().nonnegative().optional(),
  })
  .strict();
export const ExerciseGroupUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    display_order: z.number().int().nonnegative().optional(),
  })
  .strict();

// Exercises
export const ExerciseResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  group_id: IdSchema,
  name: z.string(),
  notes: z.string().nullable(),
  archived_at: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
});
export const ExerciseInputSchema = z
  .object({
    group_id: IdSchema,
    name: z.string().min(1),
    notes: z.string().nullish(),
  })
  .strict();
export const ExerciseUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    group_id: IdSchema.optional(),
    notes: z.string().nullish(),
  })
  .strict();
export const ListExercisesQuerySchema = z
  .object({
    group_id: z.coerce.number().int().positive().optional(),
    include_archived: z.coerce.boolean().optional(),
  })
  .strict();

// Workout templates
export const WorkoutTemplateItemInputSchema = z.object({
  exercise_id: IdSchema,
  display_order: z.number().int().nonnegative(),
  default_sets: z.number().int().nonnegative(),
  default_reps: z.number().int().nonnegative().nullish(),
  default_weight_kg: z.number().nullish(),
  notes: z.string().nullish(),
});
// Response shape differs from Input: nullable-only (not optional), since the API
// always materializes these fields. Drift detector enforces this — see _verify.test.ts.
export const WorkoutTemplateItemResponseSchema = z.object({
  id: IdSchema,
  template_id: IdSchema,
  exercise_id: IdSchema,
  display_order: z.number().int().nonnegative(),
  default_sets: z.number().int().nonnegative(),
  default_reps: z.number().int().nonnegative().nullable(),
  default_weight_kg: z.number().nullable(),
  notes: z.string().nullable(),
});
export const WorkoutTemplateInputSchema = z
  .object({
    name: z.string().min(1),
    notes: z.string().nullish(),
    items: z.array(WorkoutTemplateItemInputSchema),
  })
  .strict();
export const WorkoutTemplateUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    notes: z.string().nullish(),
  })
  .strict();
export const ReplaceTemplateItemsBodySchema = z
  .object({
    items: z.array(WorkoutTemplateItemInputSchema),
  })
  .strict();
export const ListWorkoutTemplatesQuerySchema = z
  .object({
    include_archived: z.coerce.boolean().optional(),
  })
  .strict();
export const WorkoutTemplateResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  name: z.string(),
  notes: z.string().nullable(),
  archived_at: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
  items: z.array(WorkoutTemplateItemResponseSchema).optional(),
});
