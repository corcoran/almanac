import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const UpdateSleepInputSchema = z.object({
  id: z.number().int().positive().describe("Sleep-log id."),
  hours: z.number().positive().optional(),
  quality: z.number().int().min(1).max(5).nullish(),
  notes: z.string().nullish(),
});

export type UpdateSleepInput = z.infer<typeof UpdateSleepInputSchema>;

export function makeUpdateSleepTool(deps: ToolDeps): Tool<UpdateSleepInput> {
  const { api } = deps;
  return {
    name: "update_sleep",
    description:
      "Correct a previously logged sleep entry. Pass the sleep-log `id` plus any fields to change. Omitted fields are left alone. Note: `slept_on` cannot be changed — delete and re-log if you need to move the date.",
    inputSchema: UpdateSleepInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const { id, ...patch } = input;
      const updated = await api.request<{ id: number }>(
        "PATCH",
        `/api/v1/sleep-logs/${id}`,
        patch,
        {
          bearer: deps.currentToken(),
        },
      );
      return { sleep_log: updated };
    },
  };
}
