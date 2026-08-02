import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const AdminSetUserLlmAccessInputSchema = z.object({
  user_id: z.number().int().positive().describe("Target user id."),
  enabled: z.boolean().describe("Enable or disable LLM meal-chat for this user."),
});

export type AdminSetUserLlmAccessInput = z.infer<typeof AdminSetUserLlmAccessInputSchema>;

export function makeAdminSetUserLlmAccessTool(deps: ToolDeps): Tool<AdminSetUserLlmAccessInput> {
  const { api } = deps;
  return {
    name: "admin_set_user_llm_access",
    description:
      "Enable or disable LLM meal-chat for another user. Requires an explicit target user id. " +
      "Admin-only — the API enforces it; a non-admin caller's request is rejected by the route.",
    inputSchema: AdminSetUserLlmAccessInputSchema,
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (input) => {
      const user = await api.request(
        "PATCH",
        `/api/v1/admin/users/${input.user_id}`,
        { llm_logging_enabled: input.enabled ? 1 : 0 },
        { bearer: deps.currentToken() },
      );
      return { user };
    },
  };
}
