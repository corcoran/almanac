import { describe, expect, it } from "vitest";
import { parseInline } from "./inline-md.js";

describe("parseInline", () => {
  it("returns a single text segment for plain text", () => {
    expect(parseInline("just words")).toEqual([{ t: "text", v: "just words" }]);
  });

  it("converts **bold** to a strong segment", () => {
    expect(parseInline("a **bold** b")).toEqual([
      { t: "text", v: "a " },
      { t: "strong", v: "bold" },
      { t: "text", v: " b" },
    ]);
  });

  it("converts `code` to a code segment", () => {
    expect(parseInline("call `get_macros` now")).toEqual([
      { t: "text", v: "call " },
      { t: "code", v: "get_macros" },
      { t: "text", v: " now" },
    ]);
  });

  it("handles mixed bold and code", () => {
    expect(parseInline("**A** and `b`")).toEqual([
      { t: "strong", v: "A" },
      { t: "text", v: " and " },
      { t: "code", v: "b" },
    ]);
  });

  it("treats HTML as literal text (no markup injection)", () => {
    expect(parseInline("<script>x</script>")).toEqual([{ t: "text", v: "<script>x</script>" }]);
  });

  it("leaves an unmatched ** as literal text", () => {
    expect(parseInline("a **b")).toEqual([{ t: "text", v: "a **b" }]);
  });
});
