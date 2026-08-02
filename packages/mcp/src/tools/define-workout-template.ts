import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

const TemplateItemInputSchema = z.object({
  exercise_id: z.number().int().positive(),
  display_order: z.number().int().nonnegative(),
  default_sets: z.number().int().nonnegative(),
  default_reps: z.number().int().nonnegative().nullish(),
  default_weight_kg: z.number().nullish(),
  notes: z.string().nullish(),
});

export const DefineWorkoutTemplateInputSchema = z.object({
  name: z.string().min(1).describe("e.g., 'Push A', 'Pull B', 'Legs'."),
  notes: z.string().nullish(),
  items: z
    .array(TemplateItemInputSchema)
    .describe(
      "Ordered exercises with their default sets/reps/weight. The LLM should typically use display_order = 0, 1, 2, ... in input order.",
    ),
});

export type DefineWorkoutTemplateInput = z.infer<typeof DefineWorkoutTemplateInputSchema>;

export function makeDefineWorkoutTemplateTool(deps: ToolDeps): Tool<DefineWorkoutTemplateInput> {
  const { api } = deps;
  return {
    name: "define_workout_template",
    description:
      "Define a workout template (e.g., 'PUSH', 'PULL', 'LEGS') — an ordered list of exercises with default sets/reps/weights that you can later log a session against. Templates contain exercises (discoverable via `list_exercises`). Log a session using this template via `log_workout` with `template_id` (use `list_workout_templates` to find the id).",
    inputSchema: DefineWorkoutTemplateInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const workout_template = await api.request<unknown>(
        "POST",
        "/api/v1/workout-templates",
        input,
        {
          bearer: deps.currentToken(),
        },
      );
      return { workout_template };
    },
  };
}
