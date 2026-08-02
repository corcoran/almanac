import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DeleteStepsInputSchema = z.object({
  step_id: z.number().int().positive().describe("ID of the step log to delete."),
  confirm: z
    .literal(true)
    .describe(
      "Must be `true`. Ask the user to confirm BEFORE setting this — the deletion is permanent.",
    ),
});

export type DeleteStepsInput = z.infer<typeof DeleteStepsInputSchema>;

export function makeDeleteStepsTool(deps: ToolDeps): Tool<DeleteStepsInput> {
  const { api } = deps;
  return {
    name: "delete_steps",
    description:
      "Permanently delete a step log. Requires explicit user confirmation: ask the user, then call with `confirm: true`. There is no undo. For step-count or kcal corrections, prefer `update_steps` instead.",
    inputSchema: DeleteStepsInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      await api.request<unknown>("DELETE", `/api/v1/step-logs/${input.step_id}`, undefined, {
        bearer: deps.currentToken(),
      });
      return { deleted: true, step_id: input.step_id };
    },
  };
}
