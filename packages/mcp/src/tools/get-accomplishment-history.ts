import { z } from "zod";
import { summarizeAccomplishment, summarizeAccomplishmentAggregates } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";
import { fetchUnitSystem } from "./user-unit.js";

export const GetAccomplishmentHistoryInputSchema = z.object({});
export type GetAccomplishmentHistoryInput = z.infer<typeof GetAccomplishmentHistoryInputSchema>;

type AggregatesLite = {
  total: number;
  by_type: Record<string, number>;
  best_by_type: Record<string, { value: number; earned_on: string } | null>;
};

type HistoryResponse = {
  accomplishments: {
    code: string;
    earned_on: string;
    value: number;
    message: string;
    details: Record<string, unknown>;
    prior_best: { earned_on: string; value: number } | null;
  }[];
  aggregates: AggregatesLite;
};

export function makeGetAccomplishmentHistoryTool(
  deps: ToolDeps,
): Tool<GetAccomplishmentHistoryInput> {
  const { api } = deps;
  return {
    name: "get_accomplishment_history",
    description:
      "Get the user's COMPLETE all-time accomplishment timeline ('wins') plus " +
      "aggregates (total count, count per type, and personal best per type — " +
      "longest streaks, most kg down). Use this for overall / all-time / " +
      "'how am I doing in general' / 'what's my personal best' questions. For just " +
      "the recent few wins to celebrate something the user JUST did, use " +
      "get_accomplishments instead. Read-only.",
    inputSchema: GetAccomplishmentHistoryInputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async () => {
      // Independent fetches — run concurrently so the unit lookup adds no extra
      // round-trip latency.
      const [unitSystem, body] = await Promise.all([
        fetchUnitSystem(deps),
        api.request<HistoryResponse>("GET", "/api/v1/signals/accomplishments/history", undefined, {
          bearer: deps.currentToken(),
        }),
      ]);
      const summary_lines = body.accomplishments.map((a) => summarizeAccomplishment(a, unitSystem));
      const aggregates_summary = summarizeAccomplishmentAggregates(body.aggregates, unitSystem);
      return { ...body, summary_lines, aggregates_summary };
    },
  };
}
