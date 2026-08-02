import { MAINTENANCE_BAND_PCT } from "@almanac/core/signals";
import { computed, ref } from "vue";

export type PhaseType = "cut" | "bulk" | "maintenance";

/**
 * Reactive state + derivations for the phase create/edit form. Owns the
 * `target = tdee + deficit` invariant (target is the primary input, deficit is
 * derived) and the phase-type/deficit band validation, using the same
 * MAINTENANCE_BAND_PCT the server enforces. No API calls — the modal wires
 * this up and performs the actual POST/PATCH.
 */
export function usePhaseForm() {
  const phaseType = ref<PhaseType>("cut");
  const tdee = ref<number | null>(null);
  const targetKcal = ref<number | null>(null);

  // Deficit is always derived: target - tdee. Null until both are known.
  const deficitKcal = computed<number | null>(() =>
    tdee.value != null && targetKcal.value != null ? targetKcal.value - tdee.value : null,
  );

  // Band: cut requires deficit beyond -band; bulk beyond +band; maintenance
  // within +/-band. band = MAINTENANCE_BAND_PCT * tdee.
  const bandError = computed<string | null>(() => {
    const t = tdee.value;
    const d = deficitKcal.value;
    if (t == null || d == null) return null;
    const band = t * MAINTENANCE_BAND_PCT;
    if (phaseType.value === "cut" && d >= -band) {
      return "That target isn't a cut — it's at or above maintenance. Lower it, or switch the phase type.";
    }
    if (phaseType.value === "bulk" && d <= band) {
      return "That target is a deficit or maintenance, not a surplus — did you mean Cut or Maintain?";
    }
    if (phaseType.value === "maintenance" && Math.abs(d) > band) {
      return "That target is too far from maintenance — did you mean Cut or Bulk?";
    }
    return null;
  });

  return { phaseType, tdee, targetKcal, deficitKcal, bandError };
}
