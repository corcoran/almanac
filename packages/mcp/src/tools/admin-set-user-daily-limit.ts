import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const AdminSetUserDailyLimitInputSchema = z.object({
  user_id: z.number().int().positive().describe("Target user id."),
  daily_token_limit: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("New daily LLM token limit, or null to clear it (rejoins the env default)."),
});

export type AdminSetUserDailyLimitInput = z.infer<typeof AdminSetUserDailyLimitInputSchema>;

export function makeAdminSetUserDailyLimitTool(deps: ToolDeps): Tool<AdminSetUserDailyLimitInput> {
  const { api } = deps;
  return {
    name: "admin_set_user_daily_limit",
    description:
      "Set or clear another user's daily LLM token limit. Requires an explicit target user id. " +
      "Pass null to clear the per-user limit so they rejoin the env default. Admin-only — the API " +
      "enforces it; a non-admin caller's request is rejected by the route.",
    inputSchema: AdminSetUserDailyLimitInputSchema,
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (input) => {
      const user = await api.request(
        "PATCH",
        `/api/v1/admin/users/${input.user_id}`,
        { llm_daily_token_limit: input.daily_token_limit },
        { bearer: deps.currentToken() },
      );
      return { user };
    },
  };
}
