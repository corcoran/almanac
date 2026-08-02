import type { Resource } from "../resource.js";
import type { ToolDeps } from "../tool.js";

export function makeStimStatesResource(deps: ToolDeps): Resource {
  const { api } = deps;
  return {
    uri: "almanac://stim-states",
    name: "Stim states by muscle group",
    description:
      "Per-muscle-group recovery state (fresh/primed/fading/fatigued) for workout suggestions.",
    mimeType: "application/json",
    handler: async () => {
      const states = await api.request<unknown>("GET", "/api/v1/signals/stim-states", undefined, {
        bearer: deps.currentToken(),
      });
      return JSON.stringify(states);
    },
  };
}
