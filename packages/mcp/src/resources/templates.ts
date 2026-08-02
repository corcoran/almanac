import type { Resource } from "../resource.js";
import type { ToolDeps } from "../tool.js";

export function makeTemplatesResource(deps: ToolDeps): Resource {
  const { api } = deps;
  return {
    uri: "almanac://templates",
    name: "Workout templates",
    description: "All non-archived workout templates with their default items.",
    mimeType: "application/json",
    handler: async () => {
      const templates = await api.request<unknown>("GET", "/api/v1/workout-templates", undefined, {
        bearer: deps.currentToken(),
      });
      return JSON.stringify(templates);
    },
  };
}
