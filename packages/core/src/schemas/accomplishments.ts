import { z } from "zod";
import { IsoDateSchema } from "./common.js";

export const AccomplishmentCodeSchema = z.enum([
  "weigh_in_streak",
  "workout_consistency",
  "target_adherence_streak",
  "weight_milestone",
  "tdee_measured",
  "strength_pr",
  "phase_complete",
  "phase_halfway",
  "workout_total",
  "volume_total",
  "meal_total",
  "weigh_in_total",
  "sleep_recovery",
]);
export type AccomplishmentCode = z.infer<typeof AccomplishmentCodeSchema>;

const PriorBestSchema = z.object({ earned_on: IsoDateSchema, value: z.number() }).nullable();

// Single flat shape (not a discriminated union) — every win carries a code,
// a user-local earned_on date, a numeric value (the milestone magnitude),
// a human message, a free-form details object, and the prior best of its code.
export const AccomplishmentSchema = z.object({
  code: AccomplishmentCodeSchema,
  earned_on: IsoDateSchema,
  value: z.number(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()),
  prior_best: PriorBestSchema,
});
export type Accomplishment = z.infer<typeof AccomplishmentSchema>;

export const AccomplishmentsResponseSchema = z.object({
  accomplishments: z.array(AccomplishmentSchema),
});
export type AccomplishmentsResponse = z.infer<typeof AccomplishmentsResponseSchema>;

// Per-code "personal best": the max value reached for a code and the date it
// was first reached. null for codes never earned (and for tdee_measured, which
// is boolean — its presence is tracked via by_type count, not a "best value").
const BestByTypeEntrySchema = z.object({ value: z.number(), earned_on: IsoDateSchema }).nullable();

export const AccomplishmentAggregatesSchema = z.object({
  total: z.number(),
  by_type: z.object({
    weigh_in_streak: z.number(),
    workout_consistency: z.number(),
    target_adherence_streak: z.number(),
    weight_milestone: z.number(),
    tdee_measured: z.number(),
    strength_pr: z.number(),
    phase_complete: z.number(),
    phase_halfway: z.number(),
    workout_total: z.number(),
    volume_total: z.number(),
    meal_total: z.number(),
    weigh_in_total: z.number(),
    sleep_recovery: z.number(),
  }),
  best_by_type: z.object({
    weigh_in_streak: BestByTypeEntrySchema,
    workout_consistency: BestByTypeEntrySchema,
    target_adherence_streak: BestByTypeEntrySchema,
    weight_milestone: BestByTypeEntrySchema,
    tdee_measured: BestByTypeEntrySchema,
    strength_pr: BestByTypeEntrySchema,
    phase_complete: BestByTypeEntrySchema,
    phase_halfway: BestByTypeEntrySchema,
    workout_total: BestByTypeEntrySchema,
    volume_total: BestByTypeEntrySchema,
    meal_total: BestByTypeEntrySchema,
    weigh_in_total: BestByTypeEntrySchema,
    sleep_recovery: BestByTypeEntrySchema,
  }),
});
export type AccomplishmentAggregates = z.infer<typeof AccomplishmentAggregatesSchema>;

// Compile-time guard: the explicit key lists in by_type / best_by_type above
// (spelled out because Zod 4's z.record(enum, …) infers Partial — see the
// achievement-history work) must stay EXACTLY in sync with AccomplishmentCode.
// `AssertSameKeys` resolves to `never` unless the two key sets are mutually
// assignable, and a `never` type argument to `Expect` is a compile error — so
// adding a code to AccomplishmentCodeSchema without adding it to both objects
// (or vice versa) breaks the build. Mirrors the ALL_CODES / BOOLEAN_CODES sync
// NOTE in signals/accomplishments.ts. Type-only — no runtime output.
type AssertSameKeys<A extends string, B extends string> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;
type Expect<T extends true> = T;
type _ByTypeKeysInSync = Expect<
  AssertSameKeys<AccomplishmentCode, keyof AccomplishmentAggregates["by_type"]>
>;
type _BestByTypeKeysInSync = Expect<
  AssertSameKeys<AccomplishmentCode, keyof AccomplishmentAggregates["best_by_type"]>
>;

export const AccomplishmentHistoryResponseSchema = z.object({
  accomplishments: z.array(AccomplishmentSchema),
  aggregates: AccomplishmentAggregatesSchema,
});
export type AccomplishmentHistoryResponse = z.infer<typeof AccomplishmentHistoryResponseSchema>;
