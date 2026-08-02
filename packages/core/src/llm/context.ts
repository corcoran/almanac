import type { Connection } from "../db/connection.js";
import { currentUserDate } from "../domain/user-day.js";
import { findActivePhase, listMeals, listStoredMeals } from "../repos/index.js";
import { computeDailyTargetForDate } from "../signals/inputs.js";

/** A compact, serializable snapshot of the user's nutrition state for the LLM. */
export type MealContext = {
  unitSystem: string;
  timezone: string;
  today: string; // user-local YYYY-MM-DD
  activePhaseTargets: {
    kcal: number;
    protein_g: number;
    carb_g: number;
    fat_g: number;
  } | null;
  storedMeals: Array<{
    id: number;
    name: string;
    kcal: number;
    protein_g: number;
    carb_g: number;
    fat_g: number;
  }>;
  recentMeals: Array<{ name: string; kcal: number; eaten_at: string }>;
  /**
   * Today's running macro state (user-local day). `consumed` is always present;
   * `target`/`remaining`/`status` are null when there's no usable phase target
   * (no active phase, or an incomplete one — no budget to remain against).
   * Sourced from `computeDailyTargetForDate`. Defensive:
   * any computation failure degrades the whole field to null (chat still works).
   */
  todayMacros: {
    consumed: { kcal: number; protein_g: number; carb_g: number; fat_g: number };
    target: { kcal: number; protein_g: number; carb_g: number; fat_g: number } | null;
    remaining: { kcal: number; protein_g: number; carb_g: number; fat_g: number } | null;
    status: "on_track" | "at_risk" | "off_track" | null;
  } | null;
  /** User-provided free-text "About Me" context, or null. Rendered into the
   *  stable (cached) prompt block as a fenced, treat-as-data section. */
  aboutMe: string | null;
};

type ContextUser = {
  id: number;
  timezone: string;
  preferred_unit_system: string;
  about_me: string | null;
};

/**
 * Assemble the meal-agent context from existing repos. Pure read; no writes.
 * `now` is injectable for deterministic tests. Carries both stable fields
 * (library, phase targets) and per-day volatile fields (`todayMacros`,
 * `recentMeals`); `buildMealSystemPrompt` partitions them into the cached vs.
 * uncached prompt blocks.
 */
export function assembleMealContext(
  db: Connection,
  user: ContextUser,
  now: Date = new Date(),
): MealContext {
  const tz = user.timezone;
  const today = currentUserDate(now, tz);

  const phase = findActivePhase(db, user.id);
  const storedMeals = listStoredMeals(db, user.id).map((m) => ({
    id: m.id,
    name: m.name,
    kcal: m.kcal,
    protein_g: m.protein_g,
    carb_g: m.carb_g,
    fat_g: m.fat_g,
  }));
  const recentMeals = listMeals(db, user.id, { limit: 10 }).map((m) => ({
    name: m.name ?? "(unnamed)",
    kcal: m.kcal,
    eaten_at: m.eaten_at,
  }));

  // Today's consumed + remaining macros for the meal coach. Defensive: a failure
  // here must never take down the chat (the feature is additive) — degrade to null.
  let todayMacros: MealContext["todayMacros"] = null;
  try {
    const dt = computeDailyTargetForDate(db, user.id, tz, today);
    if (dt.kind === "ready") {
      const consumed = dt.dayTarget.intake;
      const target = dt.dayTarget.target;
      todayMacros = {
        consumed: {
          kcal: consumed.kcal,
          protein_g: consumed.protein_g,
          carb_g: consumed.carb_g,
          fat_g: consumed.fat_g,
        },
        target: {
          kcal: target.kcal,
          protein_g: target.protein_g,
          carb_g: target.carb_g,
          fat_g: target.fat_g,
        },
        remaining: {
          kcal: target.kcal - consumed.kcal,
          protein_g: target.protein_g - consumed.protein_g,
          carb_g: target.carb_g - consumed.carb_g,
          fat_g: target.fat_g - consumed.fat_g,
        },
        status: dt.dayTarget.observed.status,
      };
    } else {
      // no_phase / phase_incomplete: show consumed (from totals), no target.
      todayMacros = {
        consumed: {
          kcal: dt.totals.kcal,
          protein_g: dt.totals.protein_g,
          carb_g: dt.totals.carb_g,
          fat_g: dt.totals.fat_g,
        },
        target: null,
        remaining: null,
        status: null,
      };
    }
  } catch {
    todayMacros = null;
  }

  return {
    unitSystem: user.preferred_unit_system,
    timezone: tz,
    today,
    activePhaseTargets: phase
      ? {
          kcal: phase.daily_kcal_target,
          protein_g: phase.base_protein_g,
          carb_g: phase.base_carb_g,
          fat_g: phase.base_fat_g,
        }
      : null,
    storedMeals,
    recentMeals,
    todayMacros,
    aboutMe: user.about_me,
  };
}
