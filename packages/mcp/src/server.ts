import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "./client.js";
import { makeCurrentUserId } from "./current-user.js";
import { ALMANAC_MCP_INSTRUCTIONS } from "./instructions.js";
import { registerResources } from "./resources/index.js";
import type { ToolDeps } from "./tool.js";
import { registerTools } from "./tools/index.js";
import { MCP_VERSION } from "./version.js";

/**
 * Bearer-less dependency bundle. The caller of `buildMcpServer` supplies the
 * shared `api` client; the per-connection bearer is threaded in separately
 * via `getToken` so one MCP process can serve multiple users (each SSE
 * connection closes over its own bearer, captured from the Authorization
 * header at GET /sse time). `currentUserId` is constructed per-connection
 * here — caching the resolved user id at connection scope matches the
 * bearer-to-identity mapping (one bearer → one user).
 */
export type McpDeps = {
  api: ApiClient;
};

export function buildMcpServer(baseDeps: McpDeps, getToken: () => string): McpServer {
  // `instructions` is shipped to the client at initialize-time per
  // MCP spec 2024-11-05. Modern clients (Claude Desktop, Claude Code,
  // ChatGPT MCP) inject it into the LLM's system prompt alongside the
  // tool list, so it's the right place for cross-cutting behavior
  // guidance — when to caveat numbers, how to surface warnings,
  // refusal boundaries, first-session onboarding hints, etc. Keep the
  // content under ~2 KB to avoid Claude Code truncating it.
  const deps: ToolDeps = {
    api: baseDeps.api,
    currentToken: getToken,
    currentUserId: makeCurrentUserId(baseDeps.api, getToken),
  };
  const server = new McpServer(
    { name: "almanac", version: MCP_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: ALMANAC_MCP_INSTRUCTIONS,
    },
  );
  registerTools(server, deps);
  registerResources(server, deps);
  return server;
}
