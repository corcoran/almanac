import type { ChangelogRelease } from "./lib/parse-changelog.js";

// Parsed CHANGELOG.md, compiled in by Vite's `define` (see vite.config.ts).
// Empty array if the changelog was unreadable in a non-release ("dev") build;
// release builds fail rather than ship an empty list (see vite.config.ts).
declare global {
  const __CHANGELOG__: ChangelogRelease[];
}
