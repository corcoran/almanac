import type { Resource } from "../resource.js";
import type { ToolDeps } from "../tool.js";

export function makePhaseCurrentResource(deps: ToolDeps): Resource {
  const { api } = deps;
  return {
    uri: "almanac://phase/current",
    name: "Active nutrition phase",
    description:
      "The currently-active phase (kcal/macro targets, intent, started_on). Returns null if none active.",
    mimeType: "application/json",
    handler: async () => {
      try {
        const phase = await api.request<unknown>(
          "GET",
          "/api/v1/nutrition-phases/active",
          undefined,
          {
            bearer: deps.currentToken(),
          },
        );
        return JSON.stringify(phase);
      } catch (err) {
        if ((err as Error).message.includes("404")) {
          return JSON.stringify(null);
        }
        throw err;
      }
    },
  };
}
