import { z } from "zod";
import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from "./common.js";

export const SexSchema = z.enum(["male", "female"]);
export const UnitSystemSchema = z.enum(["metric", "imperial"]);
export const ActivityLevelSchema = z.enum([
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
]);

/**
 * Normalize the free-text About Me field before it reaches storage and the LLM
 * prompt: strip control characters (keep newline and tab), trim, and coerce an
 * empty/whitespace-only result to null so a "cleared" field is omitted from the
 * prompt rather than rendering an empty fenced block. Length is enforced
 * separately by the schema (max 600) BEFORE this transform runs.
 */
export function sanitizeAboutMe(value: string | null | undefined): string | null {
  if (value == null) return null;
  // Strip C0/C1 control characters and DEL but KEEP tab (\x09) and newline (\x0A).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char strip
  const stripped = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
  const trimmed = stripped.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const IanaTimezoneSchema = z.string().refine(
  (s) => {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: s });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Must be a valid IANA timezone (e.g., 'America/Toronto')." },
);

export const UserResponseSchema = z.object({
  id: IdSchema,
  name: z.string(),
  dob: IsoDateSchema.nullable(),
  height_cm: z.number().positive().nullable(),
  sex: SexSchema.nullable(),
  email: z.string().nullable(),
  preferred_unit_system: UnitSystemSchema,
  timezone: z.string(),
  activity_level: ActivityLevelSchema.nullable(),
  llm_logging_enabled: z.number(),
  about_me: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});

export const UserUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    dob: IsoDateSchema.nullable().optional(),
    height_cm: z.number().positive().nullable().optional(),
    sex: SexSchema.nullable().optional(),
    preferred_unit_system: UnitSystemSchema.optional(),
    timezone: IanaTimezoneSchema.optional(),
    activity_level: ActivityLevelSchema.nullable().optional(),
    about_me: z
      .string()
      .max(600)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : sanitizeAboutMe(v))),
  })
  .strict();

/**
 * Response from `GET /v1/auth/whoami` — the subset of the user record the web
 * UI needs to render the user menu and decide locale/unit defaults. A
 * deliberately smaller surface than `UserResponseSchema`: we omit body-comp
 * fields (dob/height_cm/sex/created_at) that the chrome doesn't display, so
 * additions there don't churn this contract. Hoisted from the API route so
 * the web package can derive its store type from a single source of truth.
 */
export const WhoamiResponseSchema = z.object({
  id: IdSchema,
  name: z.string(),
  email: z.string().nullable(),
  preferred_unit_system: UnitSystemSchema,
  timezone: z.string(),
  llm_logging_enabled: z.number(),
  // Server-side LLM availability: true only when the master switch is on AND a
  // provider API key is configured. The per-user flag is necessary but NOT
  // sufficient — without this, the web UI would show the AI boxes for a flagged
  // user even when the server has no key, and every click would 403.
  llm_available: z.boolean(),
});

/**
 * Per-row shape returned by `GET /v1/auth/tokens` and (extended with the
 * cleartext `token`) by `POST /v1/auth/tokens`. Deliberately omits
 * `token_hash` — the cleartext is shown ONCE at mint time and never again,
 * and the hash never leaves the server. The `prefix` field is the
 * displayable identifier we use in the UI's revoke list.
 */
export const TokenSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
  prefix: z.string(),
  last_used_at: z.string().nullable(),
  created_at: z.string(),
});
