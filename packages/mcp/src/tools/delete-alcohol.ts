import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DeleteAlcoholInputSchema = z.object({
  alcohol_id: z.number().int().positive().describe("ID of the alcohol session to delete."),
  confirm: z
    .literal(true)
    .describe(
      "Must be `true`. Ask the user to confirm BEFORE setting this — the deletion is permanent.",
    ),
});

export type DeleteAlcoholInput = z.infer<typeof DeleteAlcoholInputSchema>;

export function makeDeleteAlcoholTool(deps: ToolDeps): Tool<DeleteAlcoholInput> {
  const { api } = deps;
  return {
    name: "delete_alcohol",
    description:
      "Permanently delete an alcohol session. Requires explicit user confirmation: ask the user, then call with `confirm: true`. There is no undo. For drinks_count/kcal corrections, prefer `update_alcohol` instead.",
    inputSchema: DeleteAlcoholInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      await api.request<unknown>(
        "DELETE",
        `/api/v1/alcohol-sessions/${input.alcohol_id}`,
        undefined,
        {
          bearer: deps.currentToken(),
        },
      );
      return { deleted: true, alcohol_id: input.alcohol_id };
    },
  };
}
