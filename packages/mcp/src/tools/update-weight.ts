import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const UpdateWeightInputSchema = z.object({
  id: z.number().int().positive().describe("Body-weight log id."),
  weight_kg: z.number().positive().optional(),
  notes: z.string().nullish(),
});

export type UpdateWeightInput = z.infer<typeof UpdateWeightInputSchema>;

export function makeUpdateWeightTool(deps: ToolDeps): Tool<UpdateWeightInput> {
  const { api } = deps;
  return {
    name: "update_weight",
    description:
      "Correct a previously logged body weight. Pass the body-weight log `id` plus any fields to change. Omitted fields are left alone. Note: `measured_on` cannot be changed — delete and re-log if you need to move the date.",
    inputSchema: UpdateWeightInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const { id, ...patch } = input;
      const updated = await api.request<{ id: number }>(
        "PATCH",
        `/api/v1/body-weights/${id}`,
        patch,
        {
          bearer: deps.currentToken(),
        },
      );
      return { body_weight: updated };
    },
  };
}
