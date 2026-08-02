import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const DeleteSetInputSchema = z.object({
  set_id: z.number().int().positive().describe("ID of the set to delete."),
  confirm: z
    .literal(true)
    .describe(
      "Must be `true`. Ask the user to confirm BEFORE setting this — the deletion is permanent.",
    ),
});

export type DeleteSetInput = z.infer<typeof DeleteSetInputSchema>;

export function makeDeleteSetTool(deps: ToolDeps): Tool<DeleteSetInput> {
  const { api } = deps;
  return {
    name: "delete_set",
    description:
      "Permanently delete a single set from a workout. Requires explicit user confirmation: ask the user, then call with `confirm: true`. There is no undo. For reps/weight corrections, prefer `update_set` instead. To remove an entire exercise instance or workout, no single-call tool exists yet — delete sets one at a time, or use `delete_workout` to wipe the whole session.",
    inputSchema: DeleteSetInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      await api.request<unknown>("DELETE", `/api/v1/sets/${input.set_id}`, undefined, {
        bearer: deps.currentToken(),
      });
      return { deleted: true, set_id: input.set_id };
    },
  };
}
