import { z } from "zod";
import { idempotencyKey, summarizeSleep } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const LogSleepInputSchema = z
  .object({
    slept_on: DateOnly.optional().describe(
      "The DATE YOU WOKE UP (morning after the night being logged). Use this OR `night_of`, not both.",
    ),
    night_of: DateOnly.optional().describe(
      "The date sleep STARTED (you went to bed). Server normalizes to slept_on = night_of + 1 day. Use this OR `slept_on`, not both.",
    ),
    hours: z.number().positive(),
    quality: z.number().int().min(1).max(5).optional(),
    notes: z.string().optional(),
  })
  .refine(
    (d) => (d.slept_on != null) !== (d.night_of != null),
    "Provide exactly one of `slept_on` (wake date) or `night_of` (date sleep started).",
  );

export type LogSleepInput = z.infer<typeof LogSleepInputSchema>;

function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function makeLogSleepTool(deps: ToolDeps): Tool<LogSleepInput> {
  const { api, currentUserId } = deps;
  return {
    name: "log_sleep",
    description:
      "Log a night's sleep. Pass EITHER `slept_on` (wake date) OR `night_of` (date sleep started) — not both. Idempotent: re-logging the same date updates the existing entry. The success summary echoes both dates so off-by-one errors are visible at log time.",
    inputSchema: LogSleepInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const userId = await currentUserId();
      // Normalize night_of → slept_on so the API contract stays slept_on-only;
      // the alias is purely an MCP-layer ergonomic affordance.
      const sleptOn = input.slept_on ?? dayAfter(input.night_of as string);
      const apiBody: { slept_on: string; hours: number; quality?: number; notes?: string } = {
        slept_on: sleptOn,
        hours: input.hours,
      };
      if (input.quality !== undefined) apiBody.quality = input.quality;
      if (input.notes !== undefined) apiBody.notes = input.notes;
      const row = await api.request<{ id: number; hours: number; quality: number | null }>(
        "POST",
        "/api/v1/sleep-logs",
        apiBody,
        {
          bearer: deps.currentToken(),
          headers: { "idempotency-key": idempotencyKey("sleep", userId, apiBody) },
        },
      );
      return { id: row.id, summary: summarizeSleep(row, sleptOn), hours: row.hours };
    },
  };
}
