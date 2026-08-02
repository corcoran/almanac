import { z } from "zod";
import type { Tool, ToolDeps } from "../tool.js";

export const PingInputSchema = z.object({});

export type PingInput = z.infer<typeof PingInputSchema>;

export function makePingTool(deps: ToolDeps): Tool<PingInput> {
  const { api } = deps;
  return {
    name: "ping",
    description:
      "Quick liveness check against the Almanac API. Returns `{ok, migrations_applied, version}`. Call this if a recent tool call failed with a network error and you want to confirm whether the server is up before retrying — much cheaper than retrying a real read or write. Don't call it preventively before every action; the API is normally up.",
    inputSchema: PingInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => {
      return await api.request<unknown>("GET", "/api/v1/health", undefined, {
        bearer: deps.currentToken(),
      });
    },
  };
}
