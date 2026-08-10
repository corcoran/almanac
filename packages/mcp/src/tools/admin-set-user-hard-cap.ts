import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const AdminSetUserHardCapInputSchema = z.object({
  user_id: z.number().int().positive().describe("Target user id."),
  hard_daily_token_cap: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe(
      "New per-user hard daily token cap (this one blocks), or null to clear it " +
        "so only the env ceiling applies.",
    ),
});

export type AdminSetUserHardCapInput = z.infer<typeof AdminSetUserHardCapInputSchema>;

export function makeAdminSetUserHardCapTool(deps: ToolDeps): Tool<AdminSetUserHardCapInput> {
  const { api } = deps;
  return {
    name: "admin_set_user_hard_cap",
    description:
      "Set or clear a user's HARD daily LLM token cap. Unlike the soft limit, this one blocks: " +
      "once the user's own day passes the cap their chats return 429 until the 4am reset. The " +
      "effective ceiling is the LOWER of this and ALMANAC_LLM_HARD_DAILY_TOKEN_CAP, so a value " +
      "here can only tighten, never raise someone above the operator's ceiling. Pass null to " +
      "clear it. Admin-only — the API route enforces it.",
    inputSchema: AdminSetUserHardCapInputSchema,
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (input) => {
      const user = await api.request(
        "PATCH",
        `/api/v1/admin/users/${input.user_id}`,
        { llm_daily_hard_cap: input.hard_daily_token_cap },
        { bearer: deps.currentToken() },
      );
      return { user };
    },
  };
}
