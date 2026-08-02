import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DeleteMealInputSchema = z.object({
  meal_id: z.number().int().positive().describe("ID of the meal to delete."),
  // Belt-and-suspenders confirmation. Even though the tool is also tagged
  // destructiveHint:true so most clients prompt the user, we ALSO refuse to
  // run without an explicit `confirm: true` so a thin client that ignores
  // annotations can't silently delete data. The AI is expected to ask the
  // user, then re-call with confirm=true.
  confirm: z
    .literal(true)
    .describe(
      "Must be `true`. Ask the user to confirm BEFORE setting this — the deletion is permanent (no soft-delete column).",
    ),
});

export type DeleteMealInput = z.infer<typeof DeleteMealInputSchema>;

export function makeDeleteMealTool(deps: ToolDeps): Tool<DeleteMealInput> {
  const { api } = deps;
  return {
    name: "delete_meal",
    description:
      "Permanently delete a meal entry. Requires explicit user confirmation: ask the user, then call with `confirm: true`. There is no undo — the row is hard-deleted. Use cases: user logged a duplicate meal, logged the wrong day, or wants to remove a one-off. For amount/macro corrections, prefer `update_meal` instead.",
    inputSchema: DeleteMealInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true, // deleting an already-deleted row is a no-op (404)
      openWorldHint: false,
    },
    handler: async (input) => {
      await api.request<unknown>("DELETE", `/api/v1/meals/${input.meal_id}`, undefined, {
        bearer: deps.currentToken(),
      });
      return { deleted: true, meal_id: input.meal_id };
    },
  };
}
