import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const AdminSetUserSoftLimitInputSchema = z.object({
  user_id: z.number().int().positive().describe("Target user id."),
  soft_daily_token_limit: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe(
      "New SOFT daily LLM token limit (advisory, never blocks), or null to clear it " +
        "(rejoins the env default).",
    ),
});

export type AdminSetUserSoftLimitInput = z.infer<typeof AdminSetUserSoftLimitInputSchema>;

export function makeAdminSetUserSoftLimitTool(deps: ToolDeps): Tool<AdminSetUserSoftLimitInput> {
  const { api } = deps;
  return {
    name: "admin_set_user_soft_limit",
    description:
      "Set or clear another user's SOFT daily LLM token limit. The soft limit is advisory: it " +
      'drives the user\'s "logs left" warning and never blocks a request. Only the hard cap ' +
      "(ALMANAC_LLM_HARD_DAILY_TOKEN_CAP, global and env-only) stops a chat, so this tool cannot " +
      "cap what someone spends. Pass null to clear the per-user value so they rejoin the env " +
      "default. Admin-only — the API route enforces it.",
    inputSchema: AdminSetUserSoftLimitInputSchema,
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (input) => {
      const user = await api.request(
        "PATCH",
        `/api/v1/admin/users/${input.user_id}`,
        // The column keeps its tier-less name; only the operator-facing surfaces
        // say "soft". Renaming it would need a migration and buys nothing.
        { llm_daily_token_limit: input.soft_daily_token_limit },
        { bearer: deps.currentToken() },
      );
      return { user };
    },
  };
}
