import { z } from "zod";
import { idempotencyKey, summarizeSteps } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const LogStepsInputSchema = z.object({
  on_date: DateOnly.describe("The calendar date the steps were taken on (YYYY-MM-DD)."),
  steps: z
    .number()
    .int()
    .positive()
    .describe(
      "Whole-day step total, at least 1. There is no such thing as a zero-step day — a missing count means the day wasn't logged.",
    ),
  est_kcal: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Optional override for the step-driven kcal estimate. When omitted, the server computes one from the latest body weight.",
    ),
  notes: z.string().optional(),
});

export type LogStepsInput = z.infer<typeof LogStepsInputSchema>;

export function makeLogStepsTool(deps: ToolDeps): Tool<LogStepsInput> {
  const { api, currentUserId } = deps;
  return {
    name: "log_steps",
    description:
      "Log a daily step count. Idempotent: re-logging the same `on_date` upserts the existing entry. When `est_kcal` is omitted, the server computes a kcal estimate from the latest body weight; pass `est_kcal` to override. Don't prompt for today's count before evening — a partial count logged early becomes the permanent record and silences the reminder that would have caught it. If the user offers one mid-day, log it and say it can be updated.",
    inputSchema: LogStepsInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const userId = await currentUserId();
      const apiBody: { on_date: string; steps: number; est_kcal?: number; notes?: string } = {
        on_date: input.on_date,
        steps: input.steps,
      };
      if (input.est_kcal !== undefined) apiBody.est_kcal = input.est_kcal;
      if (input.notes !== undefined) apiBody.notes = input.notes;
      const row = await api.request<{
        id: number;
        on_date: string;
        steps: number;
        est_kcal: number | null;
      }>("POST", "/api/v1/step-logs", apiBody, {
        bearer: deps.currentToken(),
        headers: { "idempotency-key": idempotencyKey("steps", userId, apiBody) },
      });
      return { id: row.id, summary: summarizeSteps(row) };
    },
  };
}
