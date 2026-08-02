import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetTdeeInputSchema = z.object({
  window_days: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Window in days used to estimate TDEE. Defaults to the server's default (e.g., 14)."),
});

export type GetTdeeInput = z.infer<typeof GetTdeeInputSchema>;

export function makeGetTdeeTool(deps: ToolDeps): Tool<GetTdeeInput> {
  const { api } = deps;
  return {
    name: "get_tdee",
    description:
      "Get the user's estimated TDEE (total daily energy expenditure). Always returns a usable `kcal` number plus three trust hints: `basis` is 'profile_baseline' (Mifflin BMR × activity multiplier — used when measured data is thin) or 'measured_intake' (back-calculated from logged kcal-in and the trend-weight delta); `confidence` is 'early' (profile_baseline, or measured_intake before the established threshold) or 'established' (measured_intake with enough days of weight data — currently 60+); `source` is `'formula'` (Mifflin path), `'measured'` (back-calc), or `'user_asserted'` (never emitted by /api/v1/signals/tdee — only surfaces on phase snapshots where the user provided `tdee_override`). Optional `window_days` overrides the server's default lookback.",
    inputSchema: GetTdeeInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const params = new URLSearchParams();
      if (input.window_days) params.set("window_days", String(input.window_days));
      const qs = params.toString();
      const path = qs ? `/api/v1/signals/tdee?${qs}` : "/api/v1/signals/tdee";
      return await api.request<unknown>("GET", path, undefined, { bearer: deps.currentToken() });
    },
  };
}
