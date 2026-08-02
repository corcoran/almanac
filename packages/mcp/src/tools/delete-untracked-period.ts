import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DeleteUntrackedPeriodInputSchema = z.object({
  period_id: z.number().int().positive().describe("ID of the untracked period to delete."),
  confirm: z
    .literal(true)
    .describe(
      "Must be `true`. Ask the user to confirm BEFORE setting this — the deletion is permanent.",
    ),
});

export type DeleteUntrackedPeriodInput = z.infer<typeof DeleteUntrackedPeriodInputSchema>;

export function makeDeleteUntrackedPeriodTool(deps: ToolDeps): Tool<DeleteUntrackedPeriodInput> {
  const { api } = deps;
  return {
    name: "delete_untracked_period",
    description:
      "Permanently delete an untracked period. Requires explicit user confirmation: ask the user, then call with `confirm: true`. There is no undo. Deleting re-exposes those days to the TDEE back-calc and may re-surface an `unexplained_gap`. To edit a period, delete it and create a new one.",
    inputSchema: DeleteUntrackedPeriodInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      await api.request<unknown>(
        "DELETE",
        `/api/v1/untracked-periods/${input.period_id}`,
        undefined,
        { bearer: deps.currentToken() },
      );
      return { deleted: true, period_id: input.period_id };
    },
  };
}
