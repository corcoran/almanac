import { z } from "zod";
import { summarizeWorkout } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";

// Same dual-shape schema as the HTTP API. We just forward.
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
const SetsShapeSchema = z.union([z.array(SetInputSchema), CompactSetsSchema]);
const ExerciseInstanceInputSchema = z.object({
  exercise_id: z.number().int().positive(),
  display_order: z.number().int().nonnegative(),
  planned_sets: z.number().int().nonnegative(),
  notes: z.string().nullish(),
  sets: SetsShapeSchema,
});
const DeviationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("skip"), exercise_id: z.number().int().positive() }),
  z.object({
    op: z.literal("override_sets"),
    exercise_id: z.number().int().positive(),
    sets: SetsShapeSchema,
    planned_sets: z.number().int().nonnegative().optional(),
  }),
  z.object({
    op: z.literal("add"),
    exercise_id: z.number().int().positive(),
    display_order: z.number().int().nonnegative().optional(),
    planned_sets: z.number().int().nonnegative(),
    sets: SetsShapeSchema,
  }),
]);

// Flat schema with `exercises` and `deviations` both optional, gated by a
// .refine() that asserts exactly one is present. The API still accepts both
// shapes — this layer just expresses them so zodToJsonSchema emits a single
// `type: "object"` root that MCP clients (Claude Code's stricter validation,
// at least) accept. A top-level z.union emits {anyOf: [...]} with no `type`,
// which gets rejected.
export const LogWorkoutInputSchema = z
  .object({
    template_id: z.number().int().positive().nullish(),
    started_at: z
      .string()
      .describe(
        "ISO 8601 timestamp. Pass with offset (e.g. '2026-05-08T16:20:00-04:00') or `Z` for an explicit UTC instant; pass without offset (e.g. '2026-05-08T16:20:00') to have it interpreted in the user's profile timezone (set via `update_user_profile`).",
      ),
    duration_min: z.number().int().positive().nullish(),
    rpe: z.number().min(1).max(10),
    est_kcal: z.number().int().nonnegative().nullish(),
    notes: z.string().nullish(),
    exercises: z.array(ExerciseInstanceInputSchema).optional(),
    deviations: z.array(DeviationSchema).optional(),
  })
  .refine((v) => v.exercises === undefined || v.deviations === undefined, {
    message:
      "Provide `exercises` for full-session shape OR `deviations` for template-shape, not both.",
  })
  .refine(
    (v) => v.exercises !== undefined || (v.template_id !== undefined && v.template_id !== null),
    {
      message: "Provide either `exercises` or `template_id`.",
      path: ["template_id"],
    },
  );

export type LogWorkoutInput = z.infer<typeof LogWorkoutInputSchema>;

export function makeLogWorkoutTool(deps: ToolDeps): Tool<LogWorkoutInput> {
  const { api } = deps;
  return {
    name: "log_workout",
    description: [
      "Log a workout session. Two accepted shapes:",
      "1) Full session: provide `exercises[]` explicitly.",
      "2) From template: provide `template_id`. Omit `deviations` (or pass `[]`) to log the template as written; pass `deviations[]` (`skip` / `override_sets` / `add`) to record divergences.",
      "RPE is required (1-10).",
    ].join(" "),
    inputSchema: LogWorkoutInputSchema,
    annotations: {
      readOnlyHint: false,
      // No idempotency on workouts (POST /api/v1/workouts is not idempotent per spec §6.4).
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const workout = await api.request<{
        id: number;
        rpe: number;
        template_id: number | null;
        exercises?: Array<{ exercise_id: number; sets: Array<unknown>; skipped_at: string | null }>;
      }>("POST", "/api/v1/workouts", input, { bearer: deps.currentToken() });
      return { id: workout.id, summary: summarizeWorkout(workout) };
    },
  };
}
