import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const AdminSetUserAdminInputSchema = z.object({
  user_id: z.number().int().positive().describe("Target user id."),
  is_admin: z.boolean().describe("Grant or revoke admin."),
});

export type AdminSetUserAdminInput = z.infer<typeof AdminSetUserAdminInputSchema>;

export function makeAdminSetUserAdminTool(deps: ToolDeps): Tool<AdminSetUserAdminInput> {
  const { api } = deps;
  return {
    name: "admin_set_user_admin",
    description:
      "Grant or revoke admin on another user. This is privilege escalation — admins can manage " +
      "every user's flags and limits. Requires an explicit target user id. The very first admin is " +
      "bootstrapped by a one-time direct DB edit, not through this tool. Admin-only — the API " +
      "enforces it; a non-admin caller's request is rejected by the route.",
    inputSchema: AdminSetUserAdminInputSchema,
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (input) => {
      const user = await api.request(
        "PATCH",
        `/api/v1/admin/users/${input.user_id}`,
        { is_admin: input.is_admin ? 1 : 0 },
        { bearer: deps.currentToken() },
      );
      return { user };
    },
  };
}
