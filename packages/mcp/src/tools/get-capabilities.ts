import { z } from "zod";
import { ALMANAC_CAPABILITIES } from "../capabilities.js";
import type { Tool, ToolDeps } from "../tool.js";

export const GetCapabilitiesInputSchema = z.object({});

export type GetCapabilitiesInput = z.infer<typeof GetCapabilitiesInputSchema>;

export function makeGetCapabilitiesTool(_deps: ToolDeps): Tool<GetCapabilitiesInput> {
  return {
    name: "get_capabilities",
    description:
      "Return a structured catalog of what Almanac can do: entities tracked, CRUD tools per entity, server conventions (timezone handling, units, idempotency), and common workflow recipes. Call this near the start of a session to orient yourself — much faster than reading every tool description and inferring relationships. The catalog is a single static snapshot and doesn't hit the API.",
    inputSchema: GetCapabilitiesInputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => ALMANAC_CAPABILITIES,
  };
}
