import { z } from "zod";
import { PhaseTypeSchema, TdeeSourceSchema } from "./nutrition.js";
import { ActivityLevelSchema, SexSchema } from "./users.js";

/** Query params for GET /v1/phase-estimate. All optional — returns a TDEE
 *  estimate and (when target+phase_type given) a macro suggestion the create
 *  form can pre-fill.
 *
 *  All of `activity`, `weight_kg`, `height_cm`, `sex`, and `dob` PREVIEW a
 *  not-yet-saved profile value WITHOUT persisting it — the cold-start create
 *  form passes whatever the user has typed so the Mifflin estimate
 *  (f(weight, height, age, sex) × activity) reflects their real details live,
 *  before anything is saved. Any omitted field falls back to the stored
 *  profile (or the formula's own default). */
export const PhaseEstimateQuerySchema = z.object({
  activity: ActivityLevelSchema.optional(),
  target_kcal: z.coerce.number().int().positive().optional(),
  phase_type: PhaseTypeSchema.optional(),
  weight_kg: z.coerce.number().positive().optional(),
  height_cm: z.coerce.number().positive().optional(),
  sex: SexSchema.optional(),
  dob: z.string().optional(),
});

export const PhaseEstimateResponseSchema = z.object({
  tdee: z.number().int(),
  basis: z.enum(["profile_baseline", "measured_intake"]),
  source: TdeeSourceSchema,
  has_weight: z.boolean(),
  suggested_macros: z
    .object({
      protein_g: z.number().int(),
      carb_g: z.number().int(),
      fat_g: z.number().int(),
    })
    .nullable(),
});
