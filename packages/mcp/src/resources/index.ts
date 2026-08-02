import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Resource } from "../resource.js";
import type { ToolDeps } from "../tool.js";
import { makeExercisesResource } from "./exercises.js";
import { makePhaseCurrentResource } from "./phase-current.js";
import { makeStimStatesResource } from "./stim-states.js";
import { makeTemplatesResource } from "./templates.js";
import { makeTodayResource } from "./today.js";

export function registerResources(server: McpServer, deps: ToolDeps): void {
  const resources: Resource[] = [
    makeTodayResource(deps),
    makePhaseCurrentResource(deps),
    makeStimStatesResource(deps),
    makeTemplatesResource(deps),
    makeExercisesResource(deps),
  ];

  for (const r of resources) {
    server.registerResource(
      r.name,
      r.uri,
      { description: r.description, mimeType: r.mimeType },
      async () => {
        const text = await r.handler();
        return { contents: [{ uri: r.uri, mimeType: r.mimeType, text }] };
      },
    );
  }
}
