import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const UpdateStepsInputSchema = z.object({
  id: z.number().int().positive().describe("Step-log id."),
  steps: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Whole-day step total, at least 1. There is no such thing as a zero-step day — a missing count means the day wasn't logged.",
    ),
  est_kcal: z.number().int().nonnegative().nullish(),
  notes: z.string().nullish(),
});

export type UpdateStepsInput = z.infer<typeof UpdateStepsInputSchema>;

export function makeUpdateStepsTool(deps: ToolDeps): Tool<UpdateStepsInput> {
  const { api } = deps;
  return {
    name: "update_steps",
    description:
      "Correct a previously logged step entry. Pass the step-log `id` plus any fields to change. Omitted fields are left alone. Note: `on_date` cannot be changed — delete and re-log if you need to move the date.",
    inputSchema: UpdateStepsInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const { id, ...patch } = input;
      const updated = await api.request<{ id: number }>("PATCH", `/api/v1/step-logs/${id}`, patch, {
        bearer: deps.currentToken(),
      });
      return { step_log: updated };
    },
  };
}
