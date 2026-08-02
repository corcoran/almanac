import { at } from "@almanac/core/test-support";
import { describe, expect, it } from "vitest";
import { parseChangelog } from "./parse-changelog.js";

const SAMPLE = `# Changelog

Some preamble text.

## [Unreleased]

### Added

- A thing not yet released.

## [1.25.0] - 2026-06-28

### Changed

- Finishing a workout always shows the confirmation now.

## [1.24.2] - 2026-06-27

### Fixed

- get_macros tools return full carb/fat intake.

[1.25.0]: https://example.com/compare/v1.24.3...v1.25.0
[1.24.2]: https://example.com/compare/v1.24.1...v1.24.2
`;

describe("parseChangelog", () => {
  it("skips [Unreleased] and the link-reference footer, returns releases newest-first", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases.map((r) => r.version)).toEqual(["1.25.0", "1.24.2"]);
    expect(at(releases, 0).date).toBe("2026-06-28");
    expect(at(releases, 0).items).toEqual([
      { kind: "Changed", text: "Finishing a workout always shows the confirmation now." },
    ]);
    expect(at(releases, 1).items).toEqual([
      { kind: "Fixed", text: "get_macros tools return full carb/fat intake." },
    ]);
  });

  it("parses a version header with no date as date: null", () => {
    const releases = parseChangelog(`## [9.9.9]\n\n### Added\n\n- X.\n`);
    expect(at(releases, 0).date).toBeNull();
    expect(at(releases, 0).version).toBe("9.9.9");
  });

  it("joins a multi-line wrapped bullet into one item", () => {
    const md = `## [1.0.0] - 2026-01-01\n\n### Added\n\n- First line of a long\n  bullet that wraps.\n`;
    const releases = parseChangelog(md);
    expect(at(releases, 0).items).toEqual([
      { kind: "Added", text: "First line of a long bullet that wraps." },
    ]);
  });

  it("drops items whose text starts with **Internal: (after stripping bold)", () => {
    const md = `## [1.0.0] - 2026-01-01\n\n### Changed\n\n- **Internal: refactored the dispatch loop.**\n- A real user-facing change.\n`;
    const releases = parseChangelog(md);
    expect(at(releases, 0).items).toEqual([
      { kind: "Changed", text: "A real user-facing change." },
    ]);
  });

  it("drops a release entirely when all its items are internal", () => {
    const md = `## [1.0.1] - 2026-01-02\n\n### Changed\n\n- **Internal: SDK bump.**\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- Real feature.\n`;
    const releases = parseChangelog(md);
    expect(releases.map((r) => r.version)).toEqual(["1.0.0"]);
  });
});
