import { z } from "zod";
import { summarizeAccomplishment } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";
import { fetchUnitSystem } from "./user-unit.js";

export const GetAccomplishmentsInputSchema = z.object({});
export type GetAccomplishmentsInput = z.infer<typeof GetAccomplishmentsInputSchema>;

type AccomplishmentsResponse = {
  accomplishments: {
    code: string;
    earned_on: string;
    value: number;
    message: string;
    details: Record<string, unknown>;
    prior_best: { earned_on: string; value: number } | null;
  }[];
};

export function makeGetAccomplishmentsTool(deps: ToolDeps): Tool<GetAccomplishmentsInput> {
  const { api } = deps;
  return {
    name: "get_accomplishments",
    description:
      "Get the user's recently-earned accomplishments ('wins') — logging streaks, " +
      "workout consistency, target-adherence streaks, weight milestones, the " +
      "TDEE-calibration milestone, strength PRs, phase-completion and phase-halfway " +
      "milestones, lifetime totals (workouts, kilograms lifted, meals, and " +
      "weigh-ins logged), and sleep/recovery wins — each with the prior best of its kind so you can " +
      "celebrate progress with context. Read-only. Call when the user asks how " +
      "they're doing, or to proactively give them credit.",
    inputSchema: GetAccomplishmentsInputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async () => {
      // The unit fetch and the accomplishments fetch are independent — run them
      // concurrently so the unit lookup adds no extra round-trip latency.
      const [unitSystem, body] = await Promise.all([
        fetchUnitSystem(deps),
        api.request<AccomplishmentsResponse>("GET", "/api/v1/signals/accomplishments", undefined, {
          bearer: deps.currentToken(),
        }),
      ]);
      const summary_lines = body.accomplishments.map((a) => summarizeAccomplishment(a, unitSystem));
      return { ...body, summary_lines };
    },
  };
}
