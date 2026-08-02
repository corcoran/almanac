import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DeleteSleepInputSchema = z.object({
  sleep_id: z.number().int().positive().describe("ID of the sleep log to delete."),
  confirm: z
    .literal(true)
    .describe(
      "Must be `true`. Ask the user to confirm BEFORE setting this — the deletion is permanent.",
    ),
});

export type DeleteSleepInput = z.infer<typeof DeleteSleepInputSchema>;

export function makeDeleteSleepTool(deps: ToolDeps): Tool<DeleteSleepInput> {
  const { api } = deps;
  return {
    name: "delete_sleep",
    description:
      "Permanently delete a sleep log. Requires explicit user confirmation: ask the user, then call with `confirm: true`. There is no undo. For hours/quality corrections, prefer `update_sleep` instead.",
    inputSchema: DeleteSleepInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      await api.request<unknown>("DELETE", `/api/v1/sleep-logs/${input.sleep_id}`, undefined, {
        bearer: deps.currentToken(),
      });
      return { deleted: true, sleep_id: input.sleep_id };
    },
  };
}
