import { UntrackedReasonSchema } from "@almanac/core/schemas";
import { z } from "zod";
import { ApiHttpError } from "../client.js";
import { type Tool, type ToolDeps, ToolError } from "../tool.js";

export const CreateUntrackedPeriodInputSchema = z.object({
  started_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("First untracked day (YYYY-MM-DD), inclusive."),
  ended_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Last untracked day (YYYY-MM-DD), inclusive. Must be >= started_on."),
  reason: UntrackedReasonSchema.describe("Why the gap exists: 'vacation', 'sick', or 'deload'."),
  notes: z.string().nullish().describe("Optional free-text note."),
});

export type CreateUntrackedPeriodInput = z.infer<typeof CreateUntrackedPeriodInputSchema>;

export function makeCreateUntrackedPeriodTool(deps: ToolDeps): Tool<CreateUntrackedPeriodInput> {
  const { api } = deps;
  return {
    name: "create_untracked_period",
    description:
      "Mark a stretch of days (vacation/sick/deload) as intentionally untracked so the app stops reading the gap as a real low-intake or stale stretch. Excludes those days from the measured-TDEE back-calc and clears the matching `unexplained_gap` on get_today_context. Provide an inclusive `started_on`..`ended_on` range and a `reason`. Overlapping an existing period returns an `isError: true` envelope with `error: 'period_overlap'` (a date belongs to at most one period — delete the old one to edit). Editing is delete + recreate; there is no update tool.",
    inputSchema: CreateUntrackedPeriodInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      try {
        const period = await api.request<unknown>("POST", "/api/v1/untracked-periods", input, {
          bearer: deps.currentToken(),
        });
        return { period };
      } catch (err) {
        if (err instanceof ApiHttpError && (err.status === 422 || err.status === 400)) {
          throw new ToolError(err.body);
        }
        throw err;
      }
    },
  };
}
