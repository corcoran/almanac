import type { NutritionPhase, PhaseType, TdeeSource } from "../domain/nutrition.js";
import { isWithinMaintenanceBand, STATUS_GRACE_PCT } from "./maintenance-band.js";

export type DailyTargetStatus = "on_track" | "at_risk" | "off_track";

export interface DailyTargetInput {
  phase: Omit<
    Pick<
      NutritionPhase,
      | "phase_type"
      | "tdee_at_phase_start"
      | "tdee_source"
      | "deficit_kcal"
      | "daily_kcal_target"
      | "base_protein_g"
      | "base_carb_g"
      | "base_fat_g"
    >,
    "phase_type" | "tdee_at_phase_start" | "tdee_source" | "deficit_kcal"
  > & {
    phase_type: PhaseType;
    tdee_at_phase_start: number;
    tdee_source: TdeeSource;
    deficit_kcal: number;
  };
  intake: { kcal: number; protein_g: number; carb_g: number; fat_g: number };
  cardio_kcal: number;
  workout_kcal: number;
  steps_kcal: number;
}

export interface DailyTargetOutput {
  target: { kcal: number; protein_g: number; carb_g: number; fat_g: number };
  maintenance: { kcal: number };
  intake: { kcal: number; protein_g: number; carb_g: number; fat_g: number };
  observed: {
    cardio_kcal: number;
    workout_kcal: number;
    steps_kcal: number;
    vs_target: number;
    vs_maintenance: number;
    status: DailyTargetStatus;
  };
}

/**
 * Pure computation: produces the structured target/maintenance/intake/observed
 * snapshot for a single user-day. The caller is responsible for pre-summing
 * `cardio_kcal`, `workout_kcal`, and `steps_kcal` over the user-day window.
 *
 * `target.kcal` is the *static* phase target — it does NOT shift with today's
 * activity.
 */
export function computeDailyTarget(input: DailyTargetInput): DailyTargetOutput {
  const { phase, intake, cardio_kcal, workout_kcal, steps_kcal } = input;

  if (phase.tdee_at_phase_start == null || phase.phase_type == null || phase.deficit_kcal == null) {
    throw new Error("computeDailyTarget requires a phase with new TDEE refactor fields populated");
  }

  const vs_target = intake.kcal - phase.daily_kcal_target;
  const vs_maintenance = intake.kcal - phase.tdee_at_phase_start;

  const status = computeStatus(
    phase.phase_type,
    intake.kcal,
    phase.daily_kcal_target,
    phase.tdee_at_phase_start,
  );

  return {
    target: {
      kcal: phase.daily_kcal_target,
      protein_g: phase.base_protein_g,
      carb_g: phase.base_carb_g,
      fat_g: phase.base_fat_g,
    },
    maintenance: { kcal: phase.tdee_at_phase_start },
    intake,
    observed: {
      cardio_kcal,
      workout_kcal,
      steps_kcal,
      vs_target,
      vs_maintenance,
      status,
    },
  };
}

export function computeStatus(
  phase_type: PhaseType,
  intake_kcal: number,
  target_kcal: number,
  maintenance_kcal: number,
): DailyTargetStatus {
  const grace = maintenance_kcal * STATUS_GRACE_PCT;

  switch (phase_type) {
    case "cut":
      // on_track: hit the target, OR went over by less than 10% of TDEE
      if (intake_kcal <= target_kcal + grace) return "on_track";
      // at_risk: above the grace ceiling but still in deficit
      if (intake_kcal < maintenance_kcal) return "at_risk";
      // off_track: no longer cutting
      return "off_track";
    case "bulk":
      // on_track: hit the target, OR fell short by less than 10% of TDEE
      if (intake_kcal >= target_kcal - grace) return "on_track";
      // at_risk: below the grace floor but still in surplus
      if (intake_kcal > maintenance_kcal) return "at_risk";
      // off_track: no longer bulking
      return "off_track";
    case "maintenance":
      // Unchanged: tight ±5%-of-target band, binary on/off
      return isWithinMaintenanceBand(intake_kcal, target_kcal) ? "on_track" : "off_track";
  }
}
