import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readVersion = (rel: string): string => {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
};

describe("version lockstep", () => {
  it("keeps the api and mcp package versions identical", () => {
    // Both feed the dev fallback for the reported version; a drift between
    // them means ping and /v1/health disagree on an unstamped build.
    expect(readVersion("../package.json")).toBe(readVersion("../../api/package.json"));
  });
});
