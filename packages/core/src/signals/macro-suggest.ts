import type { PhaseType } from "../domain/nutrition.js";

export type MacroSuggestion = {
  protein_g: number;
  carb_g: number;
  fat_g: number;
};

export type MacroSuggestInput = {
  weightKg: number;
  targetKcal: number;
  phaseType: PhaseType;
};

// Protein anchor by phase type (g per kg bodyweight). All three sit at the
// muscle-protective high end of the evidence-based range (~2.2–2.4 g/kg): a cut
// in a deficit needs the most protein to retain lean mass, maintenance/recomp
// slightly less, bulk in between. (The earlier 1.6–2.0 ladder produced targets
// users found too low — e.g. 133 g on a cut for a ~74 kg lifter.)
const PROTEIN_G_PER_KG: Record<PhaseType, number> = {
  cut: 2.4,
  bulk: 2.3,
  maintenance: 2.2,
};

const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARB = 4;
const KCAL_PER_G_FAT = 9;
const FAT_FRACTION_OF_KCAL = 0.25;

/**
 * Suggest a macro split from bodyweight, calorie target, and phase type.
 * Protein is bodyweight-anchored (the metric that matters on a cut); fat is a
 * fixed fraction of calories; carbs absorb the remainder (floored at 0 so a
 * tiny target never produces negative carbs). Pure — no I/O, no clock.
 */
export function suggestMacros(input: MacroSuggestInput): MacroSuggestion {
  const protein_g = Math.round(input.weightKg * PROTEIN_G_PER_KG[input.phaseType]);
  const fat_g = Math.round((input.targetKcal * FAT_FRACTION_OF_KCAL) / KCAL_PER_G_FAT);
  const remainingKcal = input.targetKcal - protein_g * KCAL_PER_G_PROTEIN - fat_g * KCAL_PER_G_FAT;
  const carb_g = Math.max(0, Math.round(remainingKcal / KCAL_PER_G_CARB));
  return { protein_g, carb_g, fat_g };
}
