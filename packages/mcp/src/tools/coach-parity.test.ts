import { INSIGHTS_TOOLS } from "@almanac/core/llm";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { buildMcpServer } from "../server.js";
import { connectTestClient } from "../test-support/mcp-harness.js";

// Every read-only MCP tool must map to an insights coach tool or an exclusion
// reason, so the coach can't fall behind what the MCP can read.
const COVERED_BY: Record<string, string> = {
  get_accomplishments: "get_accomplishments",
  get_accomplishment_history: "get_accomplishments",
  get_alcohol_recent: "get_alcohol_recent",
  get_cardio_recent: "get_cardio_recent",
  get_day_status: "get_day_status",
  get_next_best_action: "get_day_status",
  get_macros_range: "get_macros_range",
  get_meals: "list_meals_for_day",
  get_phase_history: "get_phase_history",
  get_recent_workouts: "get_recent_workouts",
  get_workout: "get_recent_workouts",
  get_recommended_template: "get_workout_recommendation",
  get_workout_recommendation: "get_workout_recommendation",
  get_sleep_recent: "get_sleep_recent",
  get_steps_recent: "get_steps_recent",
  get_tdee: "get_tdee",
  get_training_history: "get_training_history",
  get_user_profile: "get_user_profile",
  get_weight_trend: "get_weight_trend",
  get_workout_for_day: "get_workout_for_day",
  list_exercise_groups: "list_workout_templates",
  list_exercises: "list_workout_templates",
  list_workout_templates: "list_workout_templates",
  list_stored_meals: "list_stored_meals",
  list_untracked_periods: "list_untracked_periods",
};

const EXCLUDED: Record<string, string> = {
  admin_list_users: "admin surface, not user data",
  ping: "connectivity check",
  get_capabilities: "MCP-specific catalog",
  get_today_context: "embedded overview",
  get_macros_today: "embedded overview",
  get_macros_for_date: "get_report with a date",
  get_stim_state: "embedded overview (training readiness)",
  get_calendar: "get_report / get_macros_range",
  get_active_phase: "embedded overview",
};

describe("insights coach read parity", () => {
  it("maps every read-only MCP tool to a coach tool or an exclusion", async () => {
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() });
    const client = await connectTestClient(buildMcpServer({ api }, () => "alm_test"));
    const { tools } = await client.listTools();
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name);
    const coach = new Set(INSIGHTS_TOOLS.map((t) => t.name));

    const unmapped = readOnly.filter((n) => !(n in COVERED_BY) && !(n in EXCLUDED));
    expect(unmapped).toEqual([]);

    const missing = readOnly
      .filter((n) => n in COVERED_BY)
      .filter((n) => !coach.has(COVERED_BY[n] ?? ""));
    expect(missing).toEqual([]);
  });
});
