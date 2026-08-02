import { z } from "zod";

/** A 0|1 integer flag (the codebase stores booleans as INTEGER 0/1). */
const FlagSchema = z.union([z.literal(0), z.literal(1)]);

/**
 * Body for PATCH /v1/admin/users/:id. All fields optional (partial update),
 * strict (no profile-field smuggling). `llm_daily_token_limit` accepts null to
 * clear an explicit limit and rejoin the env default.
 */
export const AdminUserUpdateSchema = z
  .object({
    llm_logging_enabled: FlagSchema.optional(),
    is_admin: FlagSchema.optional(),
    llm_daily_token_limit: z.number().int().positive().nullable().optional(),
  })
  .strict();
export type AdminUserUpdate = z.infer<typeof AdminUserUpdateSchema>;

/** One row in the admin user list (GET /v1/admin/users). */
export const AdminUserSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  email: z.string().nullable(),
  llm_logging_enabled: z.number(),
  is_admin: z.number(),
  llm_daily_token_limit: z.number().nullable(),
});
export type AdminUserSummary = z.infer<typeof AdminUserSummarySchema>;
