import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DeleteStoredMealInputSchema = z.object({
  stored_meal_id: z.number().int().positive().describe("ID of the stored meal to delete."),
  confirm: z
    .literal(true)
    .describe(
      "Must be `true`. Ask the user to confirm BEFORE setting this — the deletion is permanent. " +
        "Deleting a stored meal does NOT affect any meals already logged from it.",
    ),
});

export type DeleteStoredMealInput = z.infer<typeof DeleteStoredMealInputSchema>;

export function makeDeleteStoredMealTool(deps: ToolDeps): Tool<DeleteStoredMealInput> {
  const { api } = deps;
  return {
    name: "delete_stored_meal",
    description:
      "Permanently remove a saved meal definition from the user's library. Requires explicit " +
      "user confirmation: ask the user, then call with `confirm: true`. This only removes the " +
      "definition — meals already logged from it are untouched. For edits, prefer `update_stored_meal`.",
    inputSchema: DeleteStoredMealInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      await api.request<unknown>(
        "DELETE",
        `/api/v1/stored-meals/${input.stored_meal_id}`,
        undefined,
        {
          bearer: deps.currentToken(),
        },
      );
      return { deleted: true, stored_meal_id: input.stored_meal_id };
    },
  };
}
