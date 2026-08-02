import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const AdminListUsersInputSchema = z.object({});

export type AdminListUsersInput = z.infer<typeof AdminListUsersInputSchema>;

export function makeAdminListUsersTool(deps: ToolDeps): Tool<AdminListUsersInput> {
  const { api } = deps;
  return {
    name: "admin_list_users",
    description:
      "List every user with their LLM access flag, daily token limit, and admin flag. " +
      "Use to find a target user id before setting their access/limit/admin. Admin-only — the API " +
      "enforces it; a non-admin caller's request is rejected by the route.",
    inputSchema: AdminListUsersInputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async () => {
      const users = await api.request("GET", "/api/v1/admin/users", undefined, {
        bearer: deps.currentToken(),
      });
      return { users };
    },
  };
}
