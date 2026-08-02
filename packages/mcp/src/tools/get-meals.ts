import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const GetMealsInputSchema = z.object({
  from_date: DateOnly.optional().describe(
    'Preferred. Inclusive start date (YYYY-MM-DD), interpreted in the user\'s profile timezone. Use for human-day queries (e.g. "meals on Friday"). When provided, overrides `from`/`from_days_ago`.',
  ),
  to_date: DateOnly.optional().describe(
    "Inclusive end date (YYYY-MM-DD), interpreted in the user's profile timezone. Pass the same date as from_date to select a single day.",
  ),
  from: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp inclusive lower bound. Use only for instant-precise queries; prefer from_date. Overrides from_days_ago.",
    ),
  to: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp exclusive upper bound. Use only for instant-precise queries; prefer to_date.",
    ),
  from_days_ago: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Convenience: how many days back to start. Default 7. Ignored if from_date or from is set.",
    ),
  limit: z.number().int().positive().max(200).optional(),
});

export type GetMealsInput = z.infer<typeof GetMealsInputSchema>;

function resolveFrom(
  input: { from?: string; from_days_ago?: number },
  defaultDaysAgo: number,
): string {
  if (input.from) return input.from;
  const daysAgo = input.from_days_ago ?? defaultDaysAgo;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

export function makeGetMealsTool(deps: ToolDeps): Tool<GetMealsInput> {
  const { api } = deps;
  return {
    name: "get_meals",
    description:
      'List meals in a date range. Prefer from_date/to_date (YYYY-MM-DD) — the API resolves those to the user\'s profile timezone, so "meals on Friday" gives the right answer regardless of UTC. Use from/to (ISO instants) only when you need sub-day precision. Defaults to the last 7 days.',
    inputSchema: GetMealsInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const params = new URLSearchParams();
      if (input.from_date) {
        params.set("from_date", input.from_date);
        if (input.to_date) params.set("to_date", input.to_date);
      } else {
        params.set("from", resolveFrom(input, 7));
        if (input.to) params.set("to", input.to);
        if (input.to_date) params.set("to_date", input.to_date);
      }
      if (input.limit) params.set("limit", String(input.limit));
      const meals = await api.request<
        Array<{
          id: number;
          eaten_at: string;
          kcal: number;
          protein_g: number;
          carb_g: number;
          fat_g: number;
          name: string | null;
        }>
      >("GET", `/api/v1/meals?${params.toString()}`, undefined, { bearer: deps.currentToken() });
      return { meals, count: meals.length };
    },
  };
}
