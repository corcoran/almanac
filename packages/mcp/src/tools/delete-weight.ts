import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DeleteWeightInputSchema = z.object({
  weight_id: z.number().int().positive().describe("ID of the body-weight reading to delete."),
  confirm: z
    .literal(true)
    .describe(
      "Must be `true`. Ask the user to confirm BEFORE setting this — the deletion is permanent.",
    ),
});

export type DeleteWeightInput = z.infer<typeof DeleteWeightInputSchema>;

export function makeDeleteWeightTool(deps: ToolDeps): Tool<DeleteWeightInput> {
  const { api } = deps;
  return {
    name: "delete_weight",
    description:
      "Permanently delete a body-weight reading. Requires explicit user confirmation: ask the user, then call with `confirm: true`. There is no undo. Deletes recalibrate TDEE and trend-weight — mention this caveat to the user before confirming. For value corrections, prefer `update_weight` instead.",
    inputSchema: DeleteWeightInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      await api.request<unknown>("DELETE", `/api/v1/body-weights/${input.weight_id}`, undefined, {
        bearer: deps.currentToken(),
      });
      return { deleted: true, weight_id: input.weight_id };
    },
  };
}
