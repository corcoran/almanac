import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DeleteCardioInputSchema = z.object({
  cardio_id: z.number().int().positive().describe("ID of the cardio session to delete."),
  confirm: z
    .literal(true)
    .describe(
      "Must be `true`. Ask the user to confirm BEFORE setting this — the deletion is permanent.",
    ),
});

export type DeleteCardioInput = z.infer<typeof DeleteCardioInputSchema>;

export function makeDeleteCardioTool(deps: ToolDeps): Tool<DeleteCardioInput> {
  const { api } = deps;
  return {
    name: "delete_cardio",
    description:
      "Permanently delete a cardio session. Requires explicit user confirmation: ask the user, then call with `confirm: true`. There is no undo. For modality/duration/kcal corrections, prefer `update_cardio` instead.",
    inputSchema: DeleteCardioInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      await api.request<unknown>(
        "DELETE",
        `/api/v1/cardio-sessions/${input.cardio_id}`,
        undefined,
        {
          bearer: deps.currentToken(),
        },
      );
      return { deleted: true, cardio_id: input.cardio_id };
    },
  };
}
