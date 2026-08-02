import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const UpdateSetInputSchema = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe("Set id (from the workout's nested exercises[].sets[].id)."),
  reps: z.number().int().nonnegative().optional(),
  weight_kg: z.number().nullish(),
  notes: z.string().nullish(),
});

export type UpdateSetInput = z.infer<typeof UpdateSetInputSchema>;

export function makeUpdateSetTool(deps: ToolDeps): Tool<UpdateSetInput> {
  const { api } = deps;
  return {
    name: "update_set",
    description:
      "Correct a previously logged set. Pass the set `id` plus any fields to change. Omitted fields are left alone. Use this when the user says 'oh, that third set was actually 8 reps at 85 kg'.",
    inputSchema: UpdateSetInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const { id, ...patch } = input;
      const updated = await api.request<{ id: number }>("PATCH", `/api/v1/sets/${id}`, patch, {
        bearer: deps.currentToken(),
      });
      return { set: updated };
    },
  };
}
