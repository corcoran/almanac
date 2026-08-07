/**
 * Shared by packages/api and packages/mcp so the two never derive their
 * reported version differently. `tag` is a git ref like "v1.35.0" or the
 * Dockerfile's "dev" sentinel for untagged builds; `fallback` is the
 * consuming package's own package.json version.
 */
export function resolveVersion(tag: string | undefined, fallback: string): string {
  return tag && tag !== "dev" ? tag.replace(/^v/, "") : fallback;
}
