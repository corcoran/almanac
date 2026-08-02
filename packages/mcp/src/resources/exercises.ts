import type { Resource } from "../resource.js";
import type { ToolDeps } from "../tool.js";

export function makeExercisesResource(deps: ToolDeps): Resource {
  const { api } = deps;
  return {
    uri: "almanac://exercises",
    name: "Exercise catalog",
    description: "All non-archived exercises (id, name, group_id).",
    mimeType: "application/json",
    handler: async () => {
      const exercises = await api.request<unknown>("GET", "/api/v1/exercises", undefined, {
        bearer: deps.currentToken(),
      });
      return JSON.stringify(exercises);
    },
  };
}
