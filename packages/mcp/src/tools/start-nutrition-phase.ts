import { PhaseIntentSchema, PhaseTypeSchema } from "@almanac/core/schemas";
import { z } from "zod";
import { ApiHttpError } from "../client.js";
import { type Tool, type ToolDeps, ToolError } from "../tool.js";

/**
 * MCP-side input schema for `start_nutrition_phase`. Mirrors the API's
 * `StartPhaseRequestSchema` (packages/api/src/routes/nutrition-phases.ts).
 *
 * Either `deficit_kcal` OR `daily_kcal_target` must be supplied — the API
 * derives the missing one from the resolved TDEE snapshot. `tdee_override`
 * short-circuits computeTDEE and snapshots with `tdee_source: 'user_asserted'`;
 * without it, the API falls back to computeTDEE and snapshots with whatever
 * `source` it emits. When computeTDEE can't produce a usable value (no weight
 * has ever been logged), the API returns a structured 422 `tdee_unavailable`
 * envelope, which this tool forwards verbatim as an MCP `isError: true`
 * response so the AI consumer can guide the user toward providing an override.
 */
export const StartNutritionPhaseInputSchema = z
  .object({
    name: z.string().min(1).describe("e.g., '2026 Spring cut', 'Maintenance Q4', 'Bulk-1'."),
    intent: PhaseIntentSchema.describe(
      "Legacy intent label — retains 'recomp' for backward compatibility. Use `phase_type` for the validated cut/bulk/maintenance triplet.",
    ),
    phase_type: PhaseTypeSchema.describe(
      "Narrow phase type ('cut' | 'bulk' | 'maintenance'). Validated against `deficit_kcal` (cut → < -5% of TDEE; bulk → > +5%; maintenance → within ±5%).",
    ),
    deficit_kcal: z
      .number()
      .int()
      .optional()
      .describe(
        "Signed kcal delta from TDEE: negative for cut, positive for bulk, ~0 for maintenance. Provide either `deficit_kcal` OR `daily_kcal_target` — the API derives the other from the resolved TDEE snapshot. Providing both is allowed if they're consistent (tdee + deficit === target).",
      ),
    daily_kcal_target: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Absolute daily kcal target. Provide either this OR `deficit_kcal`; see `deficit_kcal` for the consistency rule when both are supplied.",
      ),
    tdee_override: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Optional user-asserted TDEE. Use this for cold-start (no weight logged yet) or when the user explicitly overrides the computed value. Stored as `tdee_at_phase_start` with `tdee_source: 'user_asserted'`.",
      ),
    base_protein_g: z.number().int().nonnegative(),
    base_carb_g: z.number().int().nonnegative(),
    base_fat_g: z.number().int().nonnegative(),
    started_on: z.string().describe("ISO 8601 DATE (YYYY-MM-DD)."),
    planned_end_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe(
        "Optional planned end date (YYYY-MM-DD). When the user says 'this cut ends July 1', pass it here — `get_today_context.phase.days_remaining` surfaces the countdown.",
      ),
    notes: z.string().nullish(),
  })
  .refine((d) => d.deficit_kcal != null || d.daily_kcal_target != null, {
    message: "Must provide deficit_kcal or daily_kcal_target",
  });

export type StartNutritionPhaseInput = z.infer<typeof StartNutritionPhaseInputSchema>;

export function makeStartNutritionPhaseTool(deps: ToolDeps): Tool<StartNutritionPhaseInput> {
  const { api } = deps;
  return {
    name: "start_nutrition_phase",
    description:
      "Start a new nutrition phase. Automatically closes any currently-active phase (sets its `ended_on` to the day before `started_on`) — only one phase can be active at a time. Provide `phase_type` (cut/bulk/maintenance), exactly one of `deficit_kcal` or `daily_kcal_target` (the server derives the other from TDEE), and macro split. If the server can't compute TDEE (no weight logged), the tool returns an `isError: true` envelope with `error: 'tdee_unavailable'` and a `hints.suggestion` for what to ask the user before retrying with `tdee_override`. After starting a phase, call get_next_best_action — if no workout templates exist yet, it will prompt to set them up.",
    inputSchema: StartNutritionPhaseInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      try {
        const phase = await api.request<unknown>("POST", "/api/v1/nutrition-phases", input, {
          bearer: deps.currentToken(),
        });
        return { phase };
      } catch (err) {
        // Pass-through for the structured `tdee_unavailable` 422 envelope
        // (spec §"start_nutrition_phase error contract for incomplete
        // profiles"). The AI consumer reads the envelope and uses
        // `hints.suggestion` to drive the conversation toward an override.
        // Also pass-through for 400 `validation_failed` (phase-invariant or
        // deficit/target consistency) so the AI gets the same actionable
        // message the API produces.
        if (err instanceof ApiHttpError && (err.status === 422 || err.status === 400)) {
          throw new ToolError(err.body);
        }
        throw err;
      }
    },
  };
}
