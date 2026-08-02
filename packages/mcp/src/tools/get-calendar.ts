import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetCalendarInputSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM (01-12)")
    .describe("Month to render, formatted as YYYY-MM (e.g. '2026-05')."),
});

export type GetCalendarInput = z.infer<typeof GetCalendarInputSchema>;

export function makeGetCalendarTool(deps: ToolDeps): Tool<GetCalendarInput> {
  const { api } = deps;
  return {
    name: "get_calendar",
    description:
      "Get a month-view of workout cadence. Returns `tally` (total sessions plus a per-template count), `past_sessions` (one entry per workout on its calendar day), and `pill_segments` — a forward-looking strip per template showing which days are 'too_soon', 'acceptable', 'prime', or 'in_window' based on time since the template's last hit. Use this to answer 'what does my training month look like?' or 'when am I next due for PUSH?'. Segments past the in_window boundary (336h / 14d) are omitted, and if today is already past in_window for a template, no pill is returned at all.",
    inputSchema: GetCalendarInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const params = new URLSearchParams({ month: input.month });
      return await api.request<unknown>("GET", `/api/v1/calendar?${params.toString()}`, undefined, {
        bearer: deps.currentToken(),
      });
    },
  };
}
