import { z } from "zod";
import { statusPhrase } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";

export const GetMacrosTodayInputSchema = z.object({});

export type GetMacrosTodayInput = z.infer<typeof GetMacrosTodayInputSchema>;

/**
 * Subset of /api/v1/signals/today this tool reads. Post-TDEE-refactor, `today`
 * exposes the structured `{ target, maintenance, intake, observed }` block —
 * see `core/schemas/signals.ts` → `DailyTargetResponseSchema`. All four are
 * nullable individually: a user between phases has `target`, `maintenance`,
 * and `observed` all null, but `intake` (today's logged meals) is always
 * present. `effective_target` / `effective_kcal` are intentionally removed —
 * see spec §"Deprecation of effective_kcal".
 */
type TodayResponse = {
  today: {
    kcal_in: number;
    protein_g_in: number;
    carb_g_in: number;
    fat_g_in: number;
    target: { kcal: number; protein_g: number; carb_g: number; fat_g: number } | null;
    maintenance: { kcal: number } | null;
    intake: { kcal: number; protein_g: number; carb_g: number; fat_g: number };
    observed: {
      cardio_kcal: number;
      workout_kcal: number;
      vs_target: number;
      vs_maintenance: number;
      status: "on_track" | "at_risk" | "off_track";
    } | null;
    meals_logged_today: boolean;
  };
};

export function makeGetMacrosTodayTool(deps: ToolDeps): Tool<GetMacrosTodayInput> {
  const { api } = deps;
  return {
    name: "get_macros_today",
    description:
      "Get today's calorie and full macro totals so far (kcal + protein/carb/fat eaten), alongside the current phase's static target (the phase anchor — does NOT shift with today's activity) and `observed` telemetry (today's activity breakdown, deltas vs. target and maintenance, on/off-track verdict). Returns a compact projection (`*_g_in` = eaten so far, `*_g_target` = phase target) plus a one-line `summary` suitable for direct surfacing. When no nutrition phase is active, `kcal_target` / macro targets / `observed` are null and `summary` reflects the no-phase state.",
    inputSchema: GetMacrosTodayInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => {
      const t = await api.request<TodayResponse>("GET", "/api/v1/signals/today", undefined, {
        bearer: deps.currentToken(),
      });
      const today = t.today;
      // No active phase: target/maintenance/observed are all null. Surface a
      // partial result so the AI can still see intake, and signal the missing
      // phase explicitly rather than silently emitting `pct: NaN`.
      if (today.target == null) {
        const intakeSummary = today.meals_logged_today
          ? `${today.kcal_in} kcal in, ${today.protein_g_in}p / ${today.carb_g_in}c / ${today.fat_g_in}f`
          : "no meals logged yet";
        return {
          kcal_in: today.kcal_in,
          kcal_target: null,
          pct: null,
          protein_g_in: today.protein_g_in,
          carb_g_in: today.carb_g_in,
          fat_g_in: today.fat_g_in,
          protein_g_target: null,
          carb_g_target: null,
          fat_g_target: null,
          maintenance_kcal: today.maintenance?.kcal ?? null,
          observed: today.observed,
          summary: `Today: ${intakeSummary} — no active nutrition phase (start one with start_nutrition_phase to enable targets).`,
        };
      }
      const pct = Math.round((today.kcal_in / today.target.kcal) * 100);
      // Bake the adherence verdict into the summary so an AI consumer can
      // surface on-track / at-risk / off-track at a glance without reading
      // `observed.status` separately. Status only exists when a phase is
      // active (target != null implies observed != null per the schema).
      const phrase = today.observed ? ` — ${statusPhrase(today.observed.status)}` : "";
      // Data-presence guard: when no meals were logged, render an explicit
      // "no meals logged" line instead of "0/X kcal (0%) — off track, 0p".
      // The math is technically correct but misleading to an LLM consumer.
      // The target is still surfaced so the agent can answer "what's my
      // target?" without a second call.
      const summary = today.meals_logged_today
        ? `Today: ${today.kcal_in}/${today.target.kcal} kcal (${pct}%)${phrase}, ${today.protein_g_in}p / ${today.carb_g_in}c / ${today.fat_g_in}f (target ${today.target.protein_g}p / ${today.target.carb_g}c / ${today.target.fat_g}f)`
        : `Today: no meals logged yet (target ${today.target.kcal} kcal, ${today.target.protein_g}p / ${today.target.carb_g}c / ${today.target.fat_g}f).`;
      return {
        kcal_in: today.kcal_in,
        kcal_target: today.target.kcal,
        pct,
        protein_g_in: today.protein_g_in,
        carb_g_in: today.carb_g_in,
        fat_g_in: today.fat_g_in,
        protein_g_target: today.target.protein_g,
        carb_g_target: today.target.carb_g,
        fat_g_target: today.target.fat_g,
        // Maintenance is the static phase TDEE snapshot — emitted alongside
        // target so consumers don't have to call get_tdee for the comparison.
        maintenance_kcal: today.maintenance?.kcal ?? null,
        // `observed` block: today's activity breakdown, deltas, and the
        // on/off/at-risk verdict.
        observed: today.observed,
        summary,
      };
    },
  };
}
