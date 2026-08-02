import { z } from "zod";

export const IdSchema = z.number().int().positive();
/** Permissive ISO 8601 timestamp — strict format validation happens server-side. */
export const IsoDateTimeSchema = z.string().min(10);
/** Strict ISO 8601 date (YYYY-MM-DD). */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Range filter on a TIMESTAMP column (e.g., `started_at`, `eaten_at`).
 * `from` inclusive, `to` exclusive. Matches spec §6.1 cursor convention.
 *
 * `from_date` / `to_date` (YYYY-MM-DD) are the human-day form: the route
 * resolves them to UTC instants against the user's profile timezone, using
 * the same DAY_START_HOUR rollover the rest of the system uses. When both
 * date-only and timestamp forms are supplied the date-only form wins —
 * keep the wire shape consistent rather than silently mixing semantics.
 */
export const TimestampRangeQuerySchema = z
  .object({
    from: IsoDateTimeSchema.optional(),
    to: IsoDateTimeSchema.optional(),
    from_date: IsoDateSchema.optional(),
    to_date: IsoDateSchema.optional(),
    limit: z.coerce.number().int().min(0).max(200).optional(),
  })
  .strict();

/** Same as TimestampRangeQuery but for DATE columns (`measured_on`, `slept_on`). */
export const DateRangeQuerySchema = z
  .object({
    from: IsoDateSchema.optional(),
    to: IsoDateSchema.optional(),
    limit: z.coerce.number().int().min(0).max(200).optional(),
  })
  .strict();

export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type TimestampRangeQuery = z.infer<typeof TimestampRangeQuerySchema>;
export type DateRangeQuery = z.infer<typeof DateRangeQuerySchema>;
