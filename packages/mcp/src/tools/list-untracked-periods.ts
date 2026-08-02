import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const ListUntrackedPeriodsInputSchema = z.object({
  from_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Inclusive lower bound (YYYY-MM-DD). Defaults to 90 days ago."),
  to_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Inclusive upper bound (YYYY-MM-DD). Defaults to today."),
});

export type ListUntrackedPeriodsInput = z.infer<typeof ListUntrackedPeriodsInputSchema>;

export function makeListUntrackedPeriodsTool(deps: ToolDeps): Tool<ListUntrackedPeriodsInput> {
  const { api } = deps;
  return {
    name: "list_untracked_periods",
    description:
      "List the user's untracked periods (vacation/sick/deload ranges), newest first. Defaults to the last 90 days; pass `from_date`/`to_date` to widen or narrow. Use to check whether a gap is already marked before offering to create one, or to find the `period_id` to delete.",
    inputSchema: ListUntrackedPeriodsInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const params = new URLSearchParams();
      if (input.from_date) params.set("from_date", input.from_date);
      if (input.to_date) params.set("to_date", input.to_date);
      const qs = params.toString();
      const path = qs ? `/api/v1/untracked-periods?${qs}` : "/api/v1/untracked-periods";
      const periods = await api.request<unknown[]>("GET", path, undefined, {
        bearer: deps.currentToken(),
      });
      return { periods, count: periods.length };
    },
  };
}
