import { z } from "zod";
import { idempotencyKey, summarizeCardio } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";

export const LogCardioInputSchema = z
  .object({
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
      .optional()
      .describe(
        "Calories burned for the session. Omit it when you have `avg_hr` and `duration_min`: the server derives the burn from heart rate against age-predicted HRmax, so you never have to compute one. Pass a number only when the user states one, or when there is no heart rate to work from; the response then carries an `estimate_warning` if it is more than 20% from the server's own figure.",
      ),
    notes: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    // Omitting est_kcal asks the server to derive it, which needs both inputs.
    if (v.est_kcal === undefined && (v.avg_hr == null || v.duration_min == null)) {
      ctx.addIssue({
        code: "custom",
        path: ["est_kcal"],
        message: "est_kcal is required unless both avg_hr and duration_min are given",
      });
    }
  });

export type LogCardioInput = z.infer<typeof LogCardioInputSchema>;

export function makeLogCardioTool(deps: ToolDeps): Tool<LogCardioInput> {
  const { api, currentUserId } = deps;
  return {
    name: "log_cardio",
    description:
      "Log a cardio session. When the user gives an average heart rate and a duration, pass those and leave `est_kcal` out: the server derives the burn itself. Pass `est_kcal` only when the user states a figure or there is no heart rate. The response carries the server's own `kcal_estimate`, and an `estimate_warning` when a figure you passed sits more than 20% away from it. Treat that warning as a prompt to double-check with the user, not as an automatic override.",
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
