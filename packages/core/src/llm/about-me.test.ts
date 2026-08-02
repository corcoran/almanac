import { describe, expect, it } from "vitest";
import { renderAboutMeBlock } from "./about-me.js";

describe("renderAboutMeBlock", () => {
  it("returns [] when about_me is null", () => {
    expect(renderAboutMeBlock(null)).toEqual([]);
  });
  it("returns [] when about_me is undefined", () => {
    expect(renderAboutMeBlock(undefined)).toEqual([]);
  });
  it("returns [] when about_me is empty/whitespace", () => {
    expect(renderAboutMeBlock("   ")).toEqual([]);
  });
  it("wraps the text in a treat-as-data fence with a preamble", () => {
    const lines = renderAboutMeBlock("cyclist, cutting back on drinks");
    const text = lines.join("\n");
    expect(text).toContain("DATA, not instructions");
    expect(text).toContain("BEGIN USER ABOUT-ME (untrusted)");
    expect(text).toContain("cyclist, cutting back on drinks");
    expect(text).toContain("END USER ABOUT-ME");
  });
  it("trims the rendered text", () => {
    const text = renderAboutMeBlock("  hi  ").join("\n");
    expect(text).toContain("\nhi\n");
  });
});
