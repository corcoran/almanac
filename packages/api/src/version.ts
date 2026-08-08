// The API version, surfaced by the /v1/health and /v1/version routes. Released
// images report the git tag they were built from; package.json is the fallback
// for local builds, which carry no tag.
import { resolveVersion } from "@almanac/core/types";
import pkg from "../package.json" with { type: "json" };

export const API_VERSION: string = resolveVersion(process.env.ALMANAC_GIT_TAG, pkg.version);

// The git commit the running image was built from. Baked in via the
// ALMANAC_GIT_SHA env (set from a GIT_SHA build arg in the Dockerfile /
// docker-compose). Falls back to "unknown" for local dev / un-stamped builds.
// Surfaced by /v1/health so you can confirm exactly which commit is deployed
// without shelling into the server.
export const GIT_SHA: string = process.env.ALMANAC_GIT_SHA ?? "unknown";

// The release tag the running image was built from (e.g. "v1.2.3"), baked in
// via the ALMANAC_GIT_TAG env (set from a GIT_TAG build arg in the Dockerfile).
// Used to name pre-migration DB backups. Falls back to "dev" for local /
// un-tagged builds.
export const RELEASE_TAG: string = process.env.ALMANAC_GIT_TAG ?? "dev";
