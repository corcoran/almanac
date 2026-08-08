import { describe, expect, it } from "vitest";
import { resolveVersion } from "./version.js";

describe("resolveVersion", () => {
  it("strips a leading v from a real tag", () => {
    expect(resolveVersion("v1.35.0", "0.2.0")).toBe("1.35.0");
  });
  it("passes through a tag with no leading v", () => {
    expect(resolveVersion("1.35.0", "0.2.0")).toBe("1.35.0");
  });
  it("falls back to the package version for the dev sentinel", () => {
    expect(resolveVersion("dev", "0.2.0")).toBe("0.2.0");
  });
  it("falls back to the package version when the tag is undefined", () => {
    expect(resolveVersion(undefined, "0.2.0")).toBe("0.2.0");
  });
});
