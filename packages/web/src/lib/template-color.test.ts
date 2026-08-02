import { describe, expect, it } from "vitest";
import { templateColor } from "./template-color.js";

describe("templateColor", () => {
  it("returns the same color for the same name (determinism)", () => {
    expect(templateColor("PUSH A")).toBe(templateColor("PUSH A"));
    expect(templateColor("PULL B")).toBe(templateColor("PULL B"));
  });

  it("returns different colors for at least some distinct names", () => {
    // With a 12-hue palette and a stable hash, distinct short names
    // *usually* land on distinct hues. Pick name pairs that we've
    // verified collide-free by hand.
    expect(templateColor("PUSH A")).not.toBe(templateColor("PULL A"));
    expect(templateColor("PUSH A")).not.toBe(templateColor("LEGS A"));
  });

  // Regression pins for the canonical v1 template names. With the original
  // 8-hue palette + djb2-31 hash, "PULL A" and "LEGS A" landed on the same
  // hue (#e26b6b), and so did "PULL B" / "LEGS B". The palette expansion to
  // 12 + multiplier bump to 33 is what disambiguates them — if either knob
  // is reverted these assertions will fire.
  it("assigns distinct colors to common v1 template-name pairs", () => {
    expect(templateColor("PULL A")).not.toBe(templateColor("LEGS A"));
    expect(templateColor("PUSH A")).not.toBe(templateColor("PULL A"));
    expect(templateColor("PUSH A")).not.toBe(templateColor("LEGS A"));
    expect(templateColor("PUSH A")).not.toBe(templateColor("PUSH B"));
  });

  it("handles empty string without throwing and returns a palette entry", () => {
    const color = templateColor("");
    // Hash of empty string is 0 → index 0 → first palette entry.
    expect(color).toBe("#f1c453");
  });

  it("is case-sensitive: differently-cased names produce different internal hashes", () => {
    // Acceptable v1 behavior — we don't normalize before hashing. The hash
    // function distinguishes "PUSH A" from "push a", though with only 12
    // palette entries two distinctly-hashed names CAN still mod onto the
    // same color slot. That collision is a known v1 limitation; the spec
    // leaves it to a future stage to add per-template user-configurable
    // colors. What we lock in here is that the underlying classification
    // never lowercases — so once we widen the palette or rebucket, casing
    // alone IS enough to disambiguate.
    //
    // We can't directly assert the hash (it's a private impl detail), but
    // we can assert that across a sample of differently-cased pairs at
    // least one pair produces different colors — proving the hash isn't
    // case-folded to a common bucket.
    const pairs: Array<[string, string]> = [
      ["PUSH A", "push a"],
      ["LEGS A", "legs a"],
      ["PULL B", "pull b"],
      ["X1", "x1"],
      ["LONG TEMPLATE NAME", "long template name"],
    ];
    const anyDifferent = pairs.some(([u, l]) => templateColor(u) !== templateColor(l));
    expect(anyDifferent).toBe(true);
  });

  it("returns a CSS hex color string from the 12-hue palette", () => {
    const palette = new Set([
      "#f1c453",
      "#6ea8ff",
      "#e26b6b",
      "#4cc38a",
      "#d8b4fe",
      "#6ee7a8",
      "#f5c25a",
      "#f08a8a",
      "#7ed4d6",
      "#c9b380",
      "#b48cf2",
      "#e89aae",
    ]);
    for (const name of ["A", "BB", "CCC", "DDDD", "EEEEE"]) {
      expect(palette.has(templateColor(name))).toBe(true);
    }
  });
});
