# Almanac TDEE Model Refactor — Spec

## Problem

The current `base_kcal` field on `nutrition_phase` is semantically overloaded. It was set as a *target intake* (e.g., 1,900 = integrated TDEE − 500 deficit), but the daily-status math treats it as a *sedentary baseline* and adds activity kcal to derive `effective_kcal`.

This creates a sliding "target" that drifts from the user's actual cut intent:
- The integrated TDEE used to derive `base_kcal` already includes average daily activity.
- Adding activity kcal on top double-counts.
- On rest days, the display undershoots the intended deficit; on heavy training days, it overshoots.
- Activity kcal estimates have known error bars (HR-based formulas disagree by hundreds of kcal), and the additive model amplifies that noise into the user's daily eating target.

## Solution: static target, observed deficit

Treat the phase target as a fixed daily intake number. Use activity data for *observation* (what was your real net deficit today?), not *prescription* (what should you eat today?).

## Schema changes

`nutrition_phase`:
- Rename `base_kcal` → `daily_kcal_target` (semantic clarity; same data)
- Keep `base_protein_g`, `base_carb_g`, `base_fat_g` as static targets

No data migration needed beyond column rename.

## API changes

**Remove from response shapes:**
- `effective_kcal` (the additive sum)
- `activity_kcal` as a *target adjustment*

**Add to `get_macros_today`, `get_macros_for_date`, `get_day_status`:**

```
{
  target: { kcal, protein_g, carb_g, fat_g },         // static, from phase
  intake: { kcal, protein_g, carb_g, fat_g },         // logged today
  observed: {
    estimated_tdee_today,                              // see formula below
    cardio_kcal,                                        // informational
    workout_kcal,                                       // informational
    net_energy_balance: estimated_tdee_today - intake.kcal
  }
}
```

**`estimated_tdee_today` formula:**

```
estimated_tdee_today =
  tdee_baseline
  + (activity_kcal_today - avg_daily_activity_kcal)
```

Where `tdee_baseline` comes from existing `get_tdee` (profile_baseline or measured_intake) and `avg_daily_activity_kcal` is a rolling 14-day average of cardio + workout kcal. This isolates day-to-day variance from training intensity, rather than adding raw activity onto a baseline that already includes average activity.

## UI / consumer changes

Two distinct numbers, never conflated:

1. **Target (the anchor):** "Today: 642 / 1,900 kcal — 33% of target." Static, doesn't move.
2. **Observed (the telemetry):** "Estimated TDEE today: ~3,050. Net deficit today: ~775." Informational; not a prescription to eat more.

This separates "am I hitting my plan?" (target vs intake) from "what deficit did I actually run?" (observed TDEE vs intake) — two different questions that the old model collapsed into one ambiguous answer.

## Why this model

- **Robustness to activity estimate noise.** HR-derived kcal estimates have ±20–40% error. A static target absorbs that noise; an additive target turns it into miseating.
- **Matches the deficit derivation.** The original `base_kcal` was computed from integrated TDEE − deficit. The static model preserves that math; the additive model breaks it.
- **Matches how coaches set cuts.** Most evidence-based coaches use static targets and trust weekly weight trend as the feedback signal, not per-day eat-back math.
- **Better psychology on rest days.** Target stays at 1,900 instead of dropping to ~1,550 (which feels punitive and triggers compensation eating).
- **Better recovery flexibility on heavy days.** User can *choose* to eat above 1,900 on a hard day for recovery, but the system doesn't *require* it — preserving deficit integrity.

## Out of scope (potential follow-ups)

- Activity-adjusted target mode could be added later as an opt-in phase flag (`tdee_model: 'static' | 'additive'`), with the additive mode requiring `base_kcal` to be set as sedentary maintenance minus deficit. Not needed for v1.
- Weekly aggregates (`get_macros_range`) should surface both 7-day avg intake vs target *and* 7-day avg observed deficit. Same dual-display logic at the week level.

## Migration / rollout

1. Add new fields to response shapes; mark `effective_kcal` deprecated.
2. Ship UI changes to consume new fields.
3. Remove `effective_kcal` after one release cycle.
4. Rename `base_kcal` → `daily_kcal_target` (DB migration + API field rename).

No user-visible recalibration needed — the underlying number (1,900) is unchanged, only its semantic role and the math built on top of it.
