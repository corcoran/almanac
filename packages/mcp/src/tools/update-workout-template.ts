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

export const UpdateWorkoutTemplateInputSchema = z.object({
  id: z.number().int().positive().describe("Template id."),
  name: z.string().min(1).optional(),
  notes: z.string().nullish(),
  items: z
    .array(TemplateItemInputSchema)
    .optional()
    .describe(
      "If provided, REPLACES all template items. Pass the full new list — partial item updates are not supported.",
    ),
});

export type UpdateWorkoutTemplateInput = z.infer<typeof UpdateWorkoutTemplateInputSchema>;

export function makeUpdateWorkoutTemplateTool(deps: ToolDeps): Tool<UpdateWorkoutTemplateInput> {
  const { api } = deps;
  return {
    name: "update_workout_template",
    description:
      "Update an existing workout template. Pass `name`/`notes` to change the template's metadata, or `items` to wholesale-replace the exercise list (partial item edits are not supported — send the full new list). Pass both to do both. At least one of name, notes, or items must be provided.",
    inputSchema: UpdateWorkoutTemplateInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const { id, items, ...metaPatch } = input;
      let template: unknown;
      // NOTE: PATCH-then-PUT is NOT atomic. If the items PUT fails after the meta
      // PATCH succeeds, the meta change persists on the server. The LLM seeing the
      // PUT error should NOT blindly retry the same call — retry with items only,
      // or check current state with get_workout_template first.
      // Step 1: PATCH name/notes if either is present.
      const hasMeta = Object.keys(metaPatch).length > 0;
      if (hasMeta) {
        template = await api.request<unknown>(
          "PATCH",
          `/api/v1/workout-templates/${id}`,
          metaPatch,
          {
            bearer: deps.currentToken(),
          },
        );
      }
      // Step 2: PUT items if provided.
      if (items !== undefined) {
        template = await api.request<unknown>(
          "PUT",
          `/api/v1/workout-templates/${id}/items`,
          {
            items,
          },
          { bearer: deps.currentToken() },
        );
      }
      // Step 3: If nothing was passed beyond `id`, throw — there's nothing to do.
      if (!hasMeta && items === undefined) {
        throw new Error(
          "update_workout_template called with only an id — pass at least one of: name, notes, items.",
        );
      }
      return { workout_template: template };
    },
  };
}
