import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetWeightTrendInputSchema = z.object({
  from: z
    .string()
    .optional()
    .describe("YYYY-MM-DD inclusive lower bound. Overrides from_days_ago."),
  to: z.string().optional().describe("YYYY-MM-DD inclusive upper bound."),
  from_days_ago: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Convenience: how many days back to start. Default 30."),
});

export type GetWeightTrendInput = z.infer<typeof GetWeightTrendInputSchema>;

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

export function makeGetWeightTrendTool(deps: ToolDeps): Tool<GetWeightTrendInput> {
  const { api } = deps;
  return {
    name: "get_weight_trend",
    description:
      "Get the user's exponentially-weighted body-weight trend over a date range. Defaults to the last 30 days. Returns `{ points: [{ date, raw_kg, trend_kg }] }`. `raw_kg` is null on days with no weigh-in — `trend_kg` carries forward on those days rather than being recomputed.",
    inputSchema: GetWeightTrendInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const params = new URLSearchParams();
      params.set("from", resolveFromDate(input, 30));
      if (input.to) params.set("to", input.to);
      const points = await api.request<unknown[]>(
        "GET",
        `/api/v1/signals/trend-weight?${params.toString()}`,
        undefined,
        { bearer: deps.currentToken() },
      );
      return { points };
    },
  };
}
