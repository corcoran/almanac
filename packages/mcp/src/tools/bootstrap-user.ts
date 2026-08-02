import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const BootstrapUserInputSchema = z.object({
  name: z.string().min(1).describe("Your display name."),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Date of birth, YYYY-MM-DD. Used for BMR baseline; optional."),
  height_cm: z.number().positive().optional(),
  sex: z.enum(["male", "female"]).optional().describe("Used for BMR baseline; optional."),
  timezone: z
    .string()
    .optional()
    .describe(
      "IANA timezone, e.g. 'America/Toronto'. Defaults to 'UTC'. Determines the user-day window for `today`, date-range queries, and naked-local timestamps on log_* tools.",
    ),
  preferred_unit_system: z.enum(["metric", "imperial"]).optional(),
  activity_level: z
    .enum(["sedentary", "light", "moderate", "active", "very_active"])
    .optional()
    .describe(
      "Seeds the initial maintenance/TDEE estimate; refined automatically as weigh-ins accrue. Optional.",
    ),
});
export type BootstrapUserInput = z.infer<typeof BootstrapUserInputSchema>;

type UserResponse = {
  id: number;
  name: string;
  timezone: string;
};

export function makeBootstrapUserTool(deps: ToolDeps): Tool<BootstrapUserInput> {
  const { api } = deps;
  return {
    name: "bootstrap_user",
    description:
      "Create the single user that this app supports. Returns 409 if a user already exists. After bootstrap, call `start_nutrition_phase` to set targets before any signal call that needs an active phase (which is most of them). Then call get_next_best_action to walk the remaining onboarding steps in order.",
    inputSchema: BootstrapUserInputSchema,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      const user = await api.request<UserResponse>("POST", "/api/v1/users", input, {
        bearer: deps.currentToken(),
      });
      return { id: user.id, name: user.name, timezone: user.timezone };
    },
  };
}
