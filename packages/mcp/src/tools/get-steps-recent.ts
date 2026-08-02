import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const GetStepsRecentInputSchema = z.object({
  from_date: DateOnly.optional().describe(
    "Preferred. Inclusive start date (YYYY-MM-DD). Step logs are keyed by calendar date, so this is just the natural form.",
  ),
  to_date: DateOnly.optional().describe(
    "Inclusive end date (YYYY-MM-DD). Pass the same date as from_date to select a single day.",
  ),
  from: z
    .string()
    .optional()
    .describe(
      "YYYY-MM-DD inclusive lower bound. Equivalent to from_date; kept for back-compat. Overrides from_days_ago.",
    ),
  to: z
    .string()
    .optional()
    .describe("YYYY-MM-DD inclusive upper bound. Equivalent to to_date; kept for back-compat."),
  from_days_ago: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Convenience: how many days back to start. Default 14. Ignored if from_date or from is set.",
    ),
  limit: z.number().int().positive().max(200).optional(),
});

export type GetStepsRecentInput = z.infer<typeof GetStepsRecentInputSchema>;

function resolveFromDate(
  input: { from?: string; from_days_ago?: number },
  defaultDaysAgo: number,
): string {
  if (input.from) return input.from;
  const daysAgo = input.from_days_ago ?? defaultDaysAgo;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function makeGetStepsRecentTool(deps: ToolDeps): Tool<GetStepsRecentInput> {
  const { api } = deps;
  return {
    name: "get_steps_recent",
    description:
      "List step logs over a date range. Prefer from_date/to_date (YYYY-MM-DD). Defaults to the last 14 days. Widen the window explicitly when the user asks about older step history.",
    inputSchema: GetStepsRecentInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const params = new URLSearchParams();
      // Steps is DATE-keyed; the API takes plain `from`/`to` as YYYY-MM-DD.
      // `from_date`/`to_date` are just the friendlier names for parity with
      // the timestamp-keyed tools; collapse them down before sending.
      const from = input.from_date ?? resolveFromDate(input, 14);
      params.set("from", from);
      const to = input.to_date ?? input.to;
      if (to) params.set("to", to);
      if (input.limit) params.set("limit", String(input.limit));
      const step_logs = await api.request<unknown[]>(
        "GET",
        `/api/v1/step-logs?${params.toString()}`,
        undefined,
        {
          bearer: deps.currentToken(),
        },
      );
      return { step_logs, count: step_logs.length };
    },
  };
}
