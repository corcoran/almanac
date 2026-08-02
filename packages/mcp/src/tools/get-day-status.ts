import { z } from "zod";
import { statusPhrase } from "../format.js";
import type { Tool, ToolDeps } from "../tool.js";

export const GetDayStatusInputSchema = z.object({});

export type GetDayStatusInput = z.infer<typeof GetDayStatusInputSchema>;

/**
 * Subset of the day-status response we use for the summary line. Mirrors
 * `DayStatusResponseSchema` in core/schemas/signals.ts — kept loose so
 * unrelated additions to that schema don't break this tool.
 */
type DayStatusResponse = {
  date: string;
  summary: {
    kcal_in: number;
    kcal_target: number;
    protein_g_in: number;
    protein_g_target: number;
    meals_logged: boolean;
    status: "on_track" | "at_risk" | "off_track" | null;
  };
};

export function makeGetDayStatusTool(deps: ToolDeps): Tool<GetDayStatusInput> {
  const { api } = deps;
  return {
    name: "get_day_status",
    description:
      "Get an end-of-day status snapshot for the current user. Returns `summary` (kcal in vs target, protein in vs target, energy balance with food/alcohol/TDEE/activity broken out, and 'logged today?' booleans for workout/sleep/weight/alcohol/steps), a `summary_line` glanceable string that includes the on/off/at-risk verdict when a phase is active, and a `nudges` array — threshold-driven flags for patterns the user might want to know about. `summary.kcal_target` and `summary.protein_g_target` are sourced from the active phase's static `target` (the TDEE-refactor phase anchor — does NOT shift with today's activity); when no nutrition phase is active they fall back to `0` (kcal_delta will be 0 as well — nudges still fire normally for stale-weight, no-workout-streak, etc.). Each nudge has a stable `code` (`low_intake_today`, `no_workout_streak`, `stale_weight_log`, `stale_sleep_log`, `unlogged_steps`), a `severity` (`info`/`warn`/`concern`), a human-readable `message`, and per-code `details`. Use the codes to decide whether to surface a nudge proactively. Call this near end-of-day or when the user asks 'how am I doing?'.",
    inputSchema: GetDayStatusInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => {
      // Fetch day-status endpoint; status is now included directly in the response.
      const body = await api.request<DayStatusResponse>(
        "GET",
        "/api/v1/signals/day-status",
        undefined,
        { bearer: deps.currentToken() },
      );
      const s = body.summary;
      // Data-presence guard: when no meals were logged, swap the kcal-in
      // numbers for an explicit "no meals logged" phrase. Otherwise an LLM
      // reads "0/X kcal" as if the user fasted. Target/protein-target still
      // surface so the agent can answer "what's my target?" without a recall.
      if (!s.meals_logged) {
        const targetSuffix =
          s.kcal_target === 0
            ? "no active nutrition phase"
            : `target ${s.kcal_target} kcal, ${s.protein_g_target}p`;
        const summary_line = `${body.date}: no meals logged yet — ${targetSuffix}.`;
        return { ...body, summary_line };
      }
      // No active phase: day-status route returns kcal_target = 0. Emit a
      // no-phase line (still includes today's intake) without a verdict.
      if (s.kcal_target === 0) {
        const summary_line = `${body.date}: ${s.kcal_in} kcal in, ${s.protein_g_in}p — no active nutrition phase.`;
        return { ...body, summary_line };
      }
      const pct = Math.round((s.kcal_in / s.kcal_target) * 100);
      const phrase = s.status ? ` — ${statusPhrase(s.status)}` : "";
      const summary_line = `${body.date}: ${s.kcal_in}/${s.kcal_target} kcal (${pct}%)${phrase}, ${s.protein_g_in}p / target ${s.protein_g_target}p.`;
      return { ...body, summary_line };
    },
  };
}
