import type { Resource } from "../resource.js";
import type { ToolDeps } from "../tool.js";

export function makeTodayResource(deps: ToolDeps): Resource {
  const { api } = deps;
  return {
    uri: "almanac://today",
    name: "Today's context",
    description:
      "Current phase, today's macros so far, stim states, sleep debt, weight trend. Use this as the default 'where is the user right now' snapshot.",
    mimeType: "application/json",
    handler: async () => {
      const ctx = await api.request<unknown>("GET", "/api/v1/signals/today", undefined, {
        bearer: deps.currentToken(),
      });
      return JSON.stringify(ctx);
    },
  };
}
