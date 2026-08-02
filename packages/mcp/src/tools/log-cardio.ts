import { z } from "zod";
import { idempotencyKey, summarizeCardio } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";

export const LogCardioInputSchema = z.object({
  started_at: z
    .string()
    .describe(
      "ISO 8601 timestamp. Pass with offset (e.g. '2026-05-08T16:20:00-04:00') or `Z` for an explicit UTC instant; pass without offset (e.g. '2026-05-08T16:20:00') to have it interpreted in the user's profile timezone (set via `update_user_profile`).",
    ),
  duration_min: z.number().int().positive().optional(),
  modality: z.string().optional().describe("e.g., 'bike', 'run', 'ruck'"),
  avg_hr: z.number().int().positive().optional(),
  distance_km: z.number().positive().optional(),
  steps: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Step count for the session, from a watch or pedometer. Optional. Daily totals are computable via SUM(steps) per user-day.",
    ),
  est_kcal: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Calories burned for the session. If `avg_hr` and `duration_min` are also provided, the server returns a `kcal_estimate` field (midpoint of Keytel and METs formulas) and an `estimate_warning` if your `est_kcal` differs by >20% — useful as a sanity check on the user's reported burn.",
    ),
  notes: z.string().optional(),
});

export type LogCardioInput = z.infer<typeof LogCardioInputSchema>;

export function makeLogCardioTool(deps: ToolDeps): Tool<LogCardioInput> {
  const { api, currentUserId } = deps;
  return {
    name: "log_cardio",
    description:
      "Log a cardio session. The user may describe raw inputs (duration, average HR, modality) — compute est_kcal from them before calling. When `avg_hr` and `duration_min` are both provided, the response includes a server-side `kcal_estimate` (midpoint of Keytel and METs) plus an `estimate_warning` when your reported `est_kcal` deviates >20% from it. Treat the warning as a prompt to double-check with the user — not as an automatic override.",
    inputSchema: LogCardioInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const userId = await currentUserId();
      const row = await api.request<{
        id: number;
        modality: string | null;
        duration_min: number | null;
        est_kcal: number;
        kcal_estimate: unknown;
        estimate_warning: unknown;
      }>("POST", "/api/v1/cardio-sessions", input, {
        bearer: deps.currentToken(),
        headers: { "idempotency-key": idempotencyKey("cardio", userId, input) },
      });
      // Pass kcal_estimate and estimate_warning through verbatim so the AI
      // can see the server's HR-derived sanity check alongside the row it
      // just logged. summarizeCardio is unchanged — it only cares about the
      // canonical fields.
      return {
        id: row.id,
        summary: summarizeCardio(row),
        est_kcal: row.est_kcal,
        kcal_estimate: row.kcal_estimate,
        estimate_warning: row.estimate_warning,
      };
    },
  };
}
