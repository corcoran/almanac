import { PhaseTypeSchema, TdeeSourceSchema } from "@almanac/core/schemas";
import { MAINTENANCE_BAND_PCT } from "@almanac/core/signals";
import { z } from "zod";
import { ApiHttpError } from "../client.js";
import { type Tool, type ToolDeps, ToolError } from "../tool.js";

export const UpdatePhaseInputSchema = z.object({
  phase_id: z.number().int().positive().describe("ID of the phase to update."),
  name: z.string().min(1).optional(),
  intent: z.enum(["cut", "bulk", "recomp", "maintenance"]).optional(),
  phase_type: PhaseTypeSchema.optional().describe(
    "Narrow TDEE-refactor phase type ('cut' | 'bulk' | 'maintenance'). Changing this re-runs the phase-invariant check against the (possibly-also-patched) `deficit_kcal`.",
  ),
  tdee_at_phase_start: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("TDEE snapshot at phase start (kcal/day). Coherence rule: see `daily_kcal_target`."),
  tdee_source: TdeeSourceSchema.optional().describe(
    "Provenance for `tdee_at_phase_start`. Usually set automatically by start_nutrition_phase; only patch this when explicitly correcting how the user's TDEE was determined.",
  ),
  deficit_kcal: z
    .number()
    .int()
    .optional()
    .describe(
      "Signed kcal delta from TDEE (cut < 0, bulk > 0, maintenance ≈ 0). Coherence rule: see `daily_kcal_target`.",
    ),
  daily_kcal_target: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Absolute daily kcal target. COHERENCE RULE — the invariant `tdee_at_phase_start + deficit_kcal === daily_kcal_target` must be preserved. If you patch ONLY ONE of these three, the patch is rejected with a clear error before any API call. Either: (a) patch `daily_kcal_target` alone (the other two stay valid relative to each other), or (b) patch `tdee_at_phase_start` and `deficit_kcal` together — the tool will auto-derive the new `daily_kcal_target`, or (c) patch all three explicitly with values that satisfy the equation.",
    ),
  base_protein_g: z.number().int().nonnegative().optional(),
  base_carb_g: z.number().int().nonnegative().optional(),
  base_fat_g: z.number().int().nonnegative().optional(),
  started_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("YYYY-MM-DD."),
  planned_end_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .describe("YYYY-MM-DD or null to clear."),
  ended_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .describe(
      "YYYY-MM-DD or null to clear. Setting this on the currently-active phase effectively ends it — prefer the `end_phase` tool for that case so the AI's intent is unambiguous.",
    ),
  notes: z.string().nullish(),
});

export type UpdatePhaseInput = z.infer<typeof UpdatePhaseInputSchema>;

/**
 * Per-spec invariant: phase_type vs deficit_kcal must agree on sign + magnitude
 * relative to the 5% maintenance band. Mirrors `validatePhaseInvariant` in the
 * API route — duplicated here so the MCP layer rejects bad patches before a
 * round-trip, with a contextual error message in the AI consumer's reach.
 */
function checkPhaseInvariant(
  phase_type: "cut" | "bulk" | "maintenance",
  deficit_kcal: number,
  tdee: number,
): string | null {
  const bandKcal = tdee * MAINTENANCE_BAND_PCT;
  switch (phase_type) {
    case "cut":
      if (deficit_kcal >= 0 || Math.abs(deficit_kcal) <= bandKcal) {
        return `Invariant violation: phase_type 'cut' requires deficit_kcal < -${Math.round(bandKcal)} (5% of TDEE ${tdee}), got ${deficit_kcal}.`;
      }
      return null;
    case "bulk":
      if (deficit_kcal <= 0 || deficit_kcal <= bandKcal) {
        return `Invariant violation: phase_type 'bulk' requires deficit_kcal > +${Math.round(bandKcal)} (5% of TDEE ${tdee}), got ${deficit_kcal}.`;
      }
      return null;
    case "maintenance":
      if (Math.abs(deficit_kcal) > bandKcal) {
        return `Invariant violation: phase_type 'maintenance' requires |deficit_kcal| <= ${Math.round(bandKcal)} (5% of TDEE ${tdee}), got ${deficit_kcal}.`;
      }
      return null;
  }
}

export function makeUpdatePhaseTool(deps: ToolDeps): Tool<UpdatePhaseInput> {
  const { api } = deps;
  return {
    name: "update_phase",
    description:
      "Update an existing nutrition phase's fields (rename, retarget macros, adjust TDEE snapshot, shift dates, edit notes). Only the fields you pass get touched. Confirm changes with the user before calling — phase edits reshape everything downstream (daily targets, plan-vs-TDEE delta, week-to-date math). For the three coupled fields `tdee_at_phase_start`, `deficit_kcal`, and `daily_kcal_target`, the invariant `tdee + deficit === target` must be preserved: patching ONLY ONE is rejected with a clear error (see the `daily_kcal_target` field doc for the three accepted patterns). When `phase_type`, `deficit_kcal`, and `tdee_at_phase_start` are all in the same patch, the phase-type vs deficit-kcal 5%-band invariant is re-validated at the MCP layer for fast feedback; partial patches are still accepted and validated server-side. For ending a phase, prefer `end_phase`. For starting a NEW phase, use `start_nutrition_phase` (which auto-closes the previously-active one).",
    inputSchema: UpdatePhaseInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const { phase_id, ...rest } = input;

      // ---- Coherence rule for the (tdee, deficit, target) triple -----------
      // The invariant is `tdee_at_phase_start + deficit_kcal === daily_kcal_target`.
      // We need to detect which subset of the three is in the patch and decide:
      //   - 0 of 3 patched         → no issue, pass through.
      //   - 1 of 3 patched         → ambiguous. Even a lone daily_kcal_target
      //                              patch is rejected: the spec's "change target
      //                              independently" phrasing refers to user intent,
      //                              not a mechanical override. We want the AI to
      //                              make the choice explicit by also patching
      //                              tdee and/or deficit (or by using end_phase +
      //                              start if the user is starting a new phase
      //                              entirely).
      //   - 2 of 3 patched         → if tdee + deficit are both patched and
      //                              target is not, derive target = tdee +
      //                              deficit and include it. Other 2-field
      //                              combinations are rejected as ambiguous.
      //   - 3 of 3 patched         → verify consistency, then pass through.
      const tdeePatched = rest.tdee_at_phase_start !== undefined;
      const defPatched = rest.deficit_kcal !== undefined;
      const targetPatched = rest.daily_kcal_target !== undefined;
      const tripleCount = Number(tdeePatched) + Number(defPatched) + Number(targetPatched);
      const body: Record<string, unknown> = { ...rest };

      if (tripleCount === 1) {
        const which = tdeePatched
          ? "tdee_at_phase_start"
          : defPatched
            ? "deficit_kcal"
            : "daily_kcal_target";
        throw new ToolError(
          {
            error: "ambiguous_patch",
            field: which,
            message:
              `Ambiguous patch: changing only \`${which}\` without the other two of the (tdee_at_phase_start, deficit_kcal, daily_kcal_target) triple would leave the phase internally inconsistent (target !== tdee + deficit). ` +
              "Please provide all three together with values that satisfy `tdee_at_phase_start + deficit_kcal === daily_kcal_target`, or patch `tdee_at_phase_start` AND `deficit_kcal` together and the tool will auto-derive `daily_kcal_target`.",
          },
          `update_phase: ambiguous single-field patch on \`${which}\``,
        );
      }
      if (tripleCount === 2) {
        if (tdeePatched && defPatched && !targetPatched) {
          // Auto-derive the new target. Safe — preserves the invariant by
          // construction.
          body.daily_kcal_target =
            (rest.tdee_at_phase_start as number) + (rest.deficit_kcal as number);
        } else {
          const missing = !tdeePatched
            ? "tdee_at_phase_start"
            : !defPatched
              ? "deficit_kcal"
              : "daily_kcal_target";
          throw new ToolError(
            {
              error: "ambiguous_patch",
              missing_field: missing,
              message:
                `Ambiguous patch: two of (tdee_at_phase_start, deficit_kcal, daily_kcal_target) were supplied but the third (\`${missing}\`) was omitted. The only auto-derivable pair is (tdee_at_phase_start + deficit_kcal) → daily_kcal_target. ` +
                "Please supply all three explicitly with consistent values, or supply only `tdee_at_phase_start` and `deficit_kcal` and let the tool derive `daily_kcal_target`.",
            },
            `update_phase: ambiguous two-field patch (missing \`${missing}\`)`,
          );
        }
      }
      if (tripleCount === 3) {
        const t = rest.tdee_at_phase_start as number;
        const d = rest.deficit_kcal as number;
        const target = rest.daily_kcal_target as number;
        if (t + d !== target) {
          throw new ToolError(
            {
              error: "inconsistent_patch",
              message: `Inconsistent patch: tdee_at_phase_start (${t}) + deficit_kcal (${d}) = ${t + d}, but daily_kcal_target is ${target}. The invariant tdee + deficit === target must hold.`,
            },
            "update_phase: inconsistent three-field patch",
          );
        }
      }

      // ---- Invariant: phase_type vs deficit_kcal (5% band) -----------------
      // Re-validate at the MCP layer so the AI gets immediate, contextual
      // feedback before the API round-trip. The API will also enforce this
      // (its own validatePhaseInvariant on the resulting phase row); the MCP
      // check is purely for latency / clarity. We only run it when we have
      // both phase_type AND deficit_kcal AND tdee_at_phase_start in the
      // patch — checking against unknown values from the unpatched phase
      // would require an extra GET round-trip, which the spec doesn't ask for.
      if (
        body.phase_type !== undefined &&
        body.deficit_kcal !== undefined &&
        body.tdee_at_phase_start !== undefined
      ) {
        const violation = checkPhaseInvariant(
          body.phase_type as "cut" | "bulk" | "maintenance",
          body.deficit_kcal as number,
          body.tdee_at_phase_start as number,
        );
        if (violation) {
          throw new ToolError(
            { error: "validation_failed", message: violation },
            "update_phase: phase-type/deficit invariant violation",
          );
        }
      }

      try {
        const phase = await api.request<unknown>(
          "PATCH",
          `/api/v1/nutrition-phases/${phase_id}`,
          body,
          { bearer: deps.currentToken() },
        );
        return { phase };
      } catch (err) {
        // Forward 400 validation_failed from the API verbatim — preserves the
        // platform-standard error envelope the AI consumer already knows how
        // to render.
        if (err instanceof ApiHttpError && err.status === 400) {
          throw new ToolError(err.body);
        }
        throw err;
      }
    },
  };
}
