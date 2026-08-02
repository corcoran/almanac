import { z } from "zod";
import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from "./common.js";

/** Closed enum for an untracked period's reason. Matches the SQL CHECK on
 *  untracked_periods.reason and the UntrackedReason domain type. */
export const UntrackedReasonSchema = z.enum(["vacation", "sick", "deload"]);

/**
 * Create-period request body. `ended_on >= started_on` is enforced here so the
 * route rejects with a validation error before touching the DB (the SQL CHECK
 * is a belt-and-suspenders backstop). Overlap is checked separately in the
 * route (needs a DB read), not here.
 */
export const CreateUntrackedPeriodInputSchema = z
  .object({
    started_on: IsoDateSchema,
    ended_on: IsoDateSchema,
    reason: UntrackedReasonSchema,
    notes: z.string().nullish(),
  })
  .strict()
  .refine((d) => d.ended_on >= d.started_on, {
    message: "ended_on must be on or after started_on",
    path: ["ended_on"],
  });

/** List query: optional inclusive from/to date bounds. */
export const ListUntrackedPeriodsQuerySchema = z
  .object({
    from_date: IsoDateSchema.optional(),
    to_date: IsoDateSchema.optional(),
  })
  .strict();

/** Stored-period wire shape. `z.infer` must equal the UntrackedPeriod domain
 *  type (enforced by _verify.test.ts). */
export const UntrackedPeriodResponseSchema = z.object({
  id: IdSchema,
  user_id: IdSchema,
  started_on: IsoDateSchema,
  ended_on: IsoDateSchema,
  reason: UntrackedReasonSchema,
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});

/** Structured 422 envelope when a create would overlap an existing period. */
export const PeriodOverlapErrorSchema = z.object({
  error: z.literal("period_overlap"),
  message: z.string(),
  conflicting_period: UntrackedPeriodResponseSchema,
});
