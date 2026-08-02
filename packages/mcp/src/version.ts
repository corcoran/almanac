// The MCP server version. Imported by both the SDK serverInfo (server.ts) and
// the get_capabilities catalog (capabilities.ts) so the two can't drift. The
// value comes from packages/mcp/package.json — bump it there, not here. Keep
// it in lockstep with packages/api/package.json so get_capabilities and ping
// report the same number.
import pkg from "../package.json" with { type: "json" };

export const MCP_VERSION: string = pkg.version;
