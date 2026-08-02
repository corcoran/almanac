import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const GetSleepRecentInputSchema = z.object({
  from_date: DateOnly.optional().describe(
    "Preferred. Inclusive start date (YYYY-MM-DD). Sleep logs are keyed by calendar date, so this is just the natural form.",
  ),
  to_date: DateOnly.optional().describe(
    "Inclusive end date (YYYY-MM-DD). Pass the same date as from_date to select a single night.",
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

export type GetSleepRecentInput = z.infer<typeof GetSleepRecentInputSchema>;

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

/**
 * The tool advertises `to_date`/`to` as an *inclusive* calendar bound, but the
 * API's `to` is *exclusive* (`slept_on < to`, matching the `?before=` cursor
 * convention). Translate by sending the day after the requested date so the
 * final calendar day is included. UTC math handles month/year rollover.
 */
function inclusiveToExclusive(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function makeGetSleepRecentTool(deps: ToolDeps): Tool<GetSleepRecentInput> {
  const { api } = deps;
  return {
    name: "get_sleep_recent",
    description:
      "List sleep logs over a date range. Prefer from_date/to_date (YYYY-MM-DD). Defaults to the last 14 days. Widen the window explicitly when the user asks about older sleep.",
    inputSchema: GetSleepRecentInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const params = new URLSearchParams();
      // Sleep is DATE-keyed; the API takes plain `from`/`to` as YYYY-MM-DD.
      // `from_date`/`to_date` are just the friendlier names for parity with
      // the timestamp-keyed tools; collapse them down before sending.
      const from = input.from_date ?? resolveFromDate(input, 14);
      params.set("from", from);
      const to = input.to_date ?? input.to;
      if (to) params.set("to", inclusiveToExclusive(to));
      if (input.limit) params.set("limit", String(input.limit));
      const sleep_logs = await api.request<unknown[]>(
        "GET",
        `/api/v1/sleep-logs?${params.toString()}`,
        undefined,
        { bearer: deps.currentToken() },
      );
      return { sleep_logs, count: sleep_logs.length };
    },
  };
}
