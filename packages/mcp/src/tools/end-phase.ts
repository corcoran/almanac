import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const EndPhaseInputSchema = z.object({
  phase_id: z
    .number()
    .int()
    .positive()
    .describe(
      "ID of the phase to close. Use `get_active_phase` to find the currently-active one's id.",
    ),
  ended_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(
      "Date the phase ended (YYYY-MM-DD). Usually today, but pass a past date for retroactive closure ('I actually stopped this cut last Friday').",
    ),
});

export type EndPhaseInput = z.infer<typeof EndPhaseInputSchema>;

export function makeEndPhaseTool(deps: ToolDeps): Tool<EndPhaseInput> {
  const { api } = deps;
  return {
    name: "end_phase",
    description:
      "Close out a nutrition phase by setting its `ended_on` date. Use when the user says 'I'm done with this cut' or 'the bulk ended last week'. After ending, there is no active phase until the user calls `start_nutrition_phase` — confirm whether they want to start a new one right away or stay phase-less for a bit. To then immediately start a new phase, `start_nutrition_phase` will auto-close any still-active phase the day before its `started_on`, so the two-step (`end_phase` then `start_nutrition_phase`) is only needed when there's a gap between phases.",
    inputSchema: EndPhaseInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const phase = await api.request<unknown>(
        "PATCH",
        `/api/v1/nutrition-phases/${input.phase_id}`,
        { ended_on: input.ended_on },
        { bearer: deps.currentToken() },
      );
      return { phase };
    },
  };
}
