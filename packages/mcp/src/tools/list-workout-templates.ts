import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const ListWorkoutTemplatesInputSchema = z.object({
  include_archived: z
    .boolean()
    .optional()
    .describe("Include templates with `archived_at` set. Default false."),
});
export type ListWorkoutTemplatesInput = z.infer<typeof ListWorkoutTemplatesInputSchema>;

// Mirrors the API's WorkoutTemplateResponseSchema exactly. The drift detector
// in core (`schemas/_verify.test.ts`) keeps the schema honest; this type must
// stay in sync. Do NOT add fields the API does not return (e.g. exercise_name
// — agents resolve names via list_exercises).
type TemplateItem = {
  id: number;
  template_id: number;
  exercise_id: number;
  display_order: number;
  default_sets: number;
  default_reps: number | null;
  default_weight_kg: number | null;
  notes: string | null;
};
type TemplateResponse = {
  id: number;
  user_id: number;
  name: string;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  items?: TemplateItem[];
};

export function makeListWorkoutTemplatesTool(deps: ToolDeps): Tool<ListWorkoutTemplatesInput> {
  const { api } = deps;
  return {
    name: "list_workout_templates",
    description:
      "List the user's workout templates (e.g., PUSH, PULL, LEGS) with their default exercises and prescribed sets/reps. Templates are reusable session blueprints — log a session against one with `log_workout` (passing `template_id`). Create templates with `define_workout_template`; edit them with `update_workout_template`.",
    inputSchema: ListWorkoutTemplatesInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const suffix = input.include_archived ? "?include_archived=true" : "";
      const workout_templates = await api.request<TemplateResponse[]>(
        "GET",
        `/api/v1/workout-templates${suffix}`,
        undefined,
        { bearer: deps.currentToken() },
      );
      return { workout_templates };
    },
  };
}
