import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool, ToolDeps } from "../tool.js";
import { makeAddExerciseToWorkoutTool } from "./add-exercise-to-workout.js";
import { makeAdminListUsersTool } from "./admin-list-users.js";
import { makeAdminSetUserAdminTool } from "./admin-set-user-admin.js";
import { makeAdminSetUserDailyLimitTool } from "./admin-set-user-daily-limit.js";
import { makeAdminSetUserLlmAccessTool } from "./admin-set-user-llm-access.js";
// Setup/define tools (30d).
import { makeCreateUntrackedPeriodTool } from "./create-untracked-period.js";
import { makeDefineExerciseTool } from "./define-exercise.js";
import { makeDefineExerciseGroupTool } from "./define-exercise-group.js";
import { makeDefineStoredMealTool } from "./define-stored-meal.js";
import { makeDefineWorkoutTemplateTool } from "./define-workout-template.js";
// Delete tools — require confirm:true on input, tagged destructiveHint:true.
import { makeDeleteAlcoholTool } from "./delete-alcohol.js";
import { makeDeleteCardioTool } from "./delete-cardio.js";
import { makeDeleteMealTool } from "./delete-meal.js";
import { makeDeleteSetTool } from "./delete-set.js";
import { makeDeleteSleepTool } from "./delete-sleep.js";
import { makeDeleteStepsTool } from "./delete-steps.js";
import { makeDeleteStoredMealTool } from "./delete-stored-meal.js";
import { makeDeleteUntrackedPeriodTool } from "./delete-untracked-period.js";
import { makeDeleteWeightTool } from "./delete-weight.js";
import { makeDeleteWorkoutTool } from "./delete-workout.js";
// Phase lifecycle.
import { makeEndPhaseTool } from "./end-phase.js";
import { makeGetAccomplishmentHistoryTool } from "./get-accomplishment-history.js";
import { makeGetAccomplishmentsTool } from "./get-accomplishments.js";
import { makeGetActivePhaseTool } from "./get-active-phase.js";
import { makeGetAlcoholRecentTool } from "./get-alcohol-recent.js";
import { makeGetCalendarTool } from "./get-calendar.js";
// Discovery — static catalog of entities + tools + workflows.
import { makeGetCapabilitiesTool } from "./get-capabilities.js";
import { makeGetCardioRecentTool } from "./get-cardio-recent.js";
import { makeGetDayStatusTool } from "./get-day-status.js";
import { makeGetMacrosForDateTool } from "./get-macros-for-date.js";
import { makeGetMacrosRangeTool } from "./get-macros-range.js";
import { makeGetMacrosTodayTool } from "./get-macros-today.js";
import { makeGetMealsTool } from "./get-meals.js";
import { makeGetNextBestActionTool } from "./get-next-best-action.js";
import { makeGetPhaseHistoryTool } from "./get-phase-history.js";
import { makeGetRecentWorkoutsTool } from "./get-recent-workouts.js";
import {
  makeGetRecommendedTemplateTool,
  makeGetWorkoutRecommendationTool,
} from "./get-recommended-template.js";
import { makeGetSleepRecentTool } from "./get-sleep-recent.js";
import { makeGetStepsRecentTool } from "./get-steps-recent.js";
import { makeGetStimStateTool } from "./get-stim-state.js";
import { makeGetTdeeTool } from "./get-tdee.js";
// Read tools (30b).
import { makeGetTodayContextTool } from "./get-today-context.js";
import { makeGetTrainingHistoryTool } from "./get-training-history.js";
import { makeGetUserProfileTool } from "./get-user-profile.js";
import { makeGetWeightTrendTool } from "./get-weight-trend.js";
import { makeGetWorkoutTool } from "./get-workout.js";
import { makeGetWorkoutForDayTool } from "./get-workout-for-day.js";
import { makeListExerciseGroupsTool } from "./list-exercise-groups.js";
import { makeListExercisesTool } from "./list-exercises.js";
import { makeListStoredMealsTool } from "./list-stored-meals.js";
import { makeListUntrackedPeriodsTool } from "./list-untracked-periods.js";
import { makeListWorkoutTemplatesTool } from "./list-workout-templates.js";
import { makeLogAlcoholTool } from "./log-alcohol.js";
import { makeLogCardioTool } from "./log-cardio.js";
import { makeLogMealTool } from "./log-meal.js";
import { makeLogMealFromStoredTool } from "./log-meal-from-stored.js";
import { makeLogSleepTool } from "./log-sleep.js";
import { makeLogStepsTool } from "./log-steps.js";
import { makeLogWeightTool } from "./log-weight.js";
import { makeLogWorkoutTool } from "./log-workout.js";
import { makePingTool } from "./ping.js";
import { makeUserTzResolver, registerOneTool } from "./register.js";
import { makeStartNutritionPhaseTool } from "./start-nutrition-phase.js";
import { makeUpdateAlcoholTool } from "./update-alcohol.js";
import { makeUpdateCardioTool } from "./update-cardio.js";
import { makeUpdateExerciseTool } from "./update-exercise.js";
import { makeUpdateMealTool } from "./update-meal.js";
import { makeUpdatePhaseTool } from "./update-phase.js";
import { makeUpdateSetTool } from "./update-set.js";
import { makeUpdateSleepTool } from "./update-sleep.js";
import { makeUpdateStepsTool } from "./update-steps.js";
import { makeUpdateStoredMealTool } from "./update-stored-meal.js";
import { makeUpdateUserProfileTool } from "./update-user-profile.js";
import { makeUpdateWeightTool } from "./update-weight.js";
// Correction tools (30c).
import { makeUpdateWorkoutTool } from "./update-workout.js";
import { makeUpdateWorkoutTemplateTool } from "./update-workout-template.js";

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const tools: Tool<unknown>[] = [
    // Write
    makeLogMealTool(deps) as Tool<unknown>,
    makeLogMealFromStoredTool(deps) as Tool<unknown>,
    makeLogWeightTool(deps) as Tool<unknown>,
    makeLogCardioTool(deps) as Tool<unknown>,
    makeLogSleepTool(deps) as Tool<unknown>,
    makeLogStepsTool(deps) as Tool<unknown>,
    makeLogAlcoholTool(deps) as Tool<unknown>,
    makeLogWorkoutTool(deps) as Tool<unknown>,
    // Read
    makeGetTodayContextTool(deps) as Tool<unknown>,
    makeGetRecentWorkoutsTool(deps) as Tool<unknown>,
    makeGetWorkoutTool(deps) as Tool<unknown>,
    makeGetWorkoutForDayTool(deps) as Tool<unknown>,
    makeGetStimStateTool(deps) as Tool<unknown>,
    makeGetMacrosTodayTool(deps) as Tool<unknown>,
    makeGetMacrosForDateTool(deps) as Tool<unknown>,
    makeGetMacrosRangeTool(deps) as Tool<unknown>,
    makeGetMealsTool(deps) as Tool<unknown>,
    makeListStoredMealsTool(deps) as Tool<unknown>,
    makeGetWeightTrendTool(deps) as Tool<unknown>,
    makeGetSleepRecentTool(deps) as Tool<unknown>,
    makeGetStepsRecentTool(deps) as Tool<unknown>,
    makeGetAlcoholRecentTool(deps) as Tool<unknown>,
    makeGetCardioRecentTool(deps) as Tool<unknown>,
    makeGetTdeeTool(deps) as Tool<unknown>,
    makeGetActivePhaseTool(deps) as Tool<unknown>,
    makeGetPhaseHistoryTool(deps) as Tool<unknown>,
    makeListExerciseGroupsTool(deps) as Tool<unknown>,
    makeListExercisesTool(deps) as Tool<unknown>,
    makeListWorkoutTemplatesTool(deps) as Tool<unknown>,
    makeGetRecommendedTemplateTool(deps) as Tool<unknown>,
    makeGetWorkoutRecommendationTool(deps) as Tool<unknown>,
    makeGetTrainingHistoryTool(deps) as Tool<unknown>,
    makeGetCalendarTool(deps) as Tool<unknown>,
    makeGetUserProfileTool(deps) as Tool<unknown>,
    makeGetDayStatusTool(deps) as Tool<unknown>,
    makeGetAccomplishmentsTool(deps) as Tool<unknown>,
    makeGetAccomplishmentHistoryTool(deps) as Tool<unknown>,
    makeListUntrackedPeriodsTool(deps) as Tool<unknown>,
    makeGetNextBestActionTool(deps) as Tool<unknown>,
    makeGetCapabilitiesTool(deps) as Tool<unknown>,
    makePingTool(deps) as Tool<unknown>,
    // Correction
    makeUpdateWorkoutTool(deps) as Tool<unknown>,
    makeUpdateStoredMealTool(deps) as Tool<unknown>,
    makeUpdateSetTool(deps) as Tool<unknown>,
    makeUpdateMealTool(deps) as Tool<unknown>,
    makeUpdateWeightTool(deps) as Tool<unknown>,
    makeUpdateSleepTool(deps) as Tool<unknown>,
    makeUpdateStepsTool(deps) as Tool<unknown>,
    makeUpdateCardioTool(deps) as Tool<unknown>,
    makeUpdateAlcoholTool(deps) as Tool<unknown>,
    makeUpdateExerciseTool(deps) as Tool<unknown>,
    makeUpdatePhaseTool(deps) as Tool<unknown>,
    makeEndPhaseTool(deps) as Tool<unknown>,
    makeAddExerciseToWorkoutTool(deps) as Tool<unknown>,
    // Delete (confirm:true required)
    makeDeleteMealTool(deps) as Tool<unknown>,
    makeDeleteStoredMealTool(deps) as Tool<unknown>,
    makeDeleteCardioTool(deps) as Tool<unknown>,
    makeDeleteSleepTool(deps) as Tool<unknown>,
    makeDeleteStepsTool(deps) as Tool<unknown>,
    makeDeleteWeightTool(deps) as Tool<unknown>,
    makeDeleteAlcoholTool(deps) as Tool<unknown>,
    makeDeleteWorkoutTool(deps) as Tool<unknown>,
    makeDeleteSetTool(deps) as Tool<unknown>,
    makeDeleteUntrackedPeriodTool(deps) as Tool<unknown>,
    // Setup
    makeDefineStoredMealTool(deps) as Tool<unknown>,
    makeDefineExerciseGroupTool(deps) as Tool<unknown>,
    makeDefineExerciseTool(deps) as Tool<unknown>,
    makeDefineWorkoutTemplateTool(deps) as Tool<unknown>,
    makeUpdateWorkoutTemplateTool(deps) as Tool<unknown>,
    makeStartNutritionPhaseTool(deps) as Tool<unknown>,
    makeCreateUntrackedPeriodTool(deps) as Tool<unknown>,
    makeUpdateUserProfileTool(deps) as Tool<unknown>,
    // Admin
    makeAdminListUsersTool(deps) as Tool<unknown>,
    makeAdminSetUserAdminTool(deps) as Tool<unknown>,
    makeAdminSetUserDailyLimitTool(deps) as Tool<unknown>,
    makeAdminSetUserLlmAccessTool(deps) as Tool<unknown>,
  ];

  const userTz = makeUserTzResolver(deps);
  for (const tool of tools) {
    // update_user_profile can change the timezone, which the _meta envelope
    // caches. Drop the cache after that write so the next tool result stamps
    // the new zone instead of the one resolved at connect time.
    const getUserTz =
      tool.name === "update_user_profile"
        ? async () => {
            userTz.invalidate();
            return userTz.get();
          }
        : userTz.get;
    registerOneTool(server, tool, getUserTz);
  }
}
