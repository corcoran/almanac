// The MCP server version. Imported by both the SDK serverInfo (server.ts) and
// the get_capabilities catalog (capabilities.ts) so the two can't drift.
// Released images report the git tag they were built from; package.json is
// the fallback for local builds, which carry no tag.
import { resolveVersion } from "@almanac/core/types";
import pkg from "../package.json" with { type: "json" };

export const MCP_VERSION: string = resolveVersion(process.env.ALMANAC_GIT_TAG, pkg.version);
