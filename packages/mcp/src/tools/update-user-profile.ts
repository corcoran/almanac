import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const UpdateUserProfileInputSchema = z.object({
  name: z.string().min(1).optional(),
  dob: z.string().nullable().optional().describe("ISO 8601 DATE (YYYY-MM-DD) or null to clear."),
  height_cm: z.number().positive().nullable().optional(),
  sex: z.enum(["male", "female"]).nullable().optional(),
  activity_level: z
    .enum(["sedentary", "light", "moderate", "active", "very_active"])
    .nullable()
    .optional()
    .describe(
      "Activity level (sedentary | light | moderate | active | very_active), or null to clear. Drives the cold-start TDEE estimate before measured TDEE kicks in.",
    ),
  preferred_unit_system: z.enum(["metric", "imperial"]).optional(),
  timezone: z
    .string()
    .optional()
    .describe(
      "IANA timezone name (e.g., 'America/Toronto'). Naked-local times in `log_*` tools are interpreted in this zone, and date-only reads (`from_date`, `to_date`) use it for day-window resolution.",
    ),
});

export type UpdateUserProfileInput = z.infer<typeof UpdateUserProfileInputSchema>;

export function makeUpdateUserProfileTool(deps: ToolDeps): Tool<UpdateUserProfileInput> {
  const { api } = deps;
  return {
    name: "update_user_profile",
    description:
      "Updates the *current* user's profile. Use this when the user shares their birthday, height, activity level, wants to switch units, or tells you what timezone they're in. Set `timezone` (IANA name like 'America/Toronto') so that naked-local log times and date-only reads bucket correctly. Pass `null` for `dob`, `height_cm`, `sex`, or `activity_level` to clear that field. After updating the profile, call get_next_best_action to see the next onboarding step.",
    inputSchema: UpdateUserProfileInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const user = await api.request<unknown>("PATCH", "/api/v1/users/me", input, {
        bearer: deps.currentToken(),
      });
      return { user };
    },
  };
}
