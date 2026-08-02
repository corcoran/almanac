import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const GetUserProfileInputSchema = z.object({});

export type GetUserProfileInput = z.infer<typeof GetUserProfileInputSchema>;

export function makeGetUserProfileTool(deps: ToolDeps): Tool<GetUserProfileInput> {
  const { api } = deps;
  return {
    name: "get_user_profile",
    description:
      "Get the *current* user's profile — name, birthday, height, sex, activity level, preferred unit system, and timezone. Useful when you need to know how to interpret naked-local times, render weights in the right units, or remind the user of values they've set previously. Pair with `update_user_profile` to change any of these. Includes the user's free-text \"about_me\" note when set.",
    inputSchema: GetUserProfileInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => {
      const user = await api.request<unknown>("GET", "/api/v1/users/me", undefined, {
        bearer: deps.currentToken(),
      });
      return { user };
    },
  };
}
