export type ChangelogKind = "Added" | "Changed" | "Fixed" | "Removed";
export type ChangelogItem = { kind: ChangelogKind; text: string };
export type ChangelogRelease = {
  version: string;
  date: string | null;
  items: ChangelogItem[];
};

const KINDS: readonly ChangelogKind[] = ["Added", "Changed", "Fixed", "Removed"];

// An item is "internal" if its text — after stripping a single leading **
// emphasis marker — begins with "Internal:". Matches the established
// "- **Internal: ...**" changelog convention (e.g. the 1.24.3 McpServer entry).
function isInternal(text: string): boolean {
  const stripped = text.startsWith("**") ? text.slice(2) : text;
  return stripped.startsWith("Internal:");
}

// "## [1.25.0] - 2026-06-28"  or  "## [9.9.9]"  (Unreleased handled separately)
const VERSION_RE = /^##\s+\[(\d+\.\d+\.\d+)\](?:\s+-\s+(\S+))?\s*$/;
const SECTION_RE = /^###\s+(\w+)\s*$/;
const BULLET_RE = /^-\s+(.*)$/;
const CONT_RE = /^\s+(\S.*)$/; // indented continuation of the previous bullet

export function parseChangelog(raw: string): ChangelogRelease[] {
  const lines = raw.split("\n");
  const releases: ChangelogRelease[] = [];
  let current: ChangelogRelease | null = null;
  let kind: ChangelogKind | null = null;

  for (const line of lines) {
    // A link-reference footer line "[1.25.0]: https://..." must NOT match a
    // version header (it has no "## "), so VERSION_RE already excludes it.
    if (line.startsWith("## [Unreleased]")) {
      current = null;
      kind = null;
      continue;
    }
    const vm = VERSION_RE.exec(line);
    if (vm) {
      const version = vm[1];
      if (version === undefined) continue;
      current = { version, date: vm[2] ?? null, items: [] };
      releases.push(current);
      kind = null;
      continue;
    }
    if (current === null) continue;

    const sm = SECTION_RE.exec(line);
    if (sm) {
      const name = sm[1];
      kind = KINDS.find((k) => k === name) ?? null;
      continue;
    }

    const bm = BULLET_RE.exec(line);
    if (bm && kind !== null) {
      const text = bm[1] ?? "";
      current.items.push({ kind, text: text.trim() });
      continue;
    }

    const cm = CONT_RE.exec(line);
    if (cm && kind !== null && current.items.length > 0) {
      const lastIdx = current.items.length - 1;
      const last = current.items[lastIdx];
      const cont = cm[1] ?? "";
      if (last !== undefined) last.text = `${last.text} ${cont.trim()}`.trim();
    }
  }

  const filtered = releases
    .map((r) => ({ ...r, items: r.items.filter((it) => !isInternal(it.text)) }))
    .filter((r) => r.items.length > 0);

  return filtered;
}
