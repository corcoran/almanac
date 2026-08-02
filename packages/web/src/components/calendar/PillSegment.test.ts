import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { templateColor } from "../../lib/template-color.js";
import PillSegment from "./PillSegment.vue";

type Phase = "too_soon" | "acceptable" | "prime" | "in_window";

describe("PillSegment", () => {
  it("renders with the phase class for each of the 4 phases", () => {
    const phases: Phase[] = ["too_soon", "acceptable", "prime", "in_window"];
    for (const phase of phases) {
      const wrapper = mount(PillSegment, {
        props: { templateName: "PUSH A", phase, isProposed: false },
      });
      const pill = wrapper.find(".pill");
      expect(pill.exists()).toBe(true);
      expect(pill.classes()).toContain(phase);
    }
  });

  it("renders the ★ only when isProposed is true", () => {
    const without = mount(PillSegment, {
      props: { templateName: "PUSH A", phase: "prime", isProposed: false },
    });
    expect(without.find(".star").exists()).toBe(false);

    const withStar = mount(PillSegment, {
      props: { templateName: "PUSH A", phase: "prime", isProposed: true },
    });
    const star = withStar.find(".star");
    expect(star.exists()).toBe(true);
    expect(star.text()).toBe("★");
  });

  it("applies templateColor() to the pill via the --pill-color CSS variable", () => {
    // The component sets `--pill-color` as an inline custom property; the
    // CSS in <style scoped> then references it for either background-color
    // (solid phases) or border-color (too_soon). We assert the variable is
    // set to the deterministic templateColor() output, which is enough to
    // prove the color identity reaches the DOM regardless of phase.
    const hex = templateColor("PUSH A");
    for (const phase of ["too_soon", "acceptable", "prime", "in_window"] as const) {
      const wrapper = mount(PillSegment, {
        props: { templateName: "PUSH A", phase, isProposed: false },
      });
      const style = wrapper.find(".pill").attributes("style") ?? "";
      // jsdom serializes custom properties as `--pill-color: #xxx;` — hex
      // form is preserved (no rgb() normalization for non-standard props).
      expect(style).toContain(`--pill-color: ${hex}`);
    }
  });

  it("renders too_soon as a transparent-fill dashed outline (spec §2 Q9)", () => {
    // too_soon must be qualitatively distinct from acceptable — not just a
    // 10% opacity bump. The CSS rule sets background-color: transparent and
    // border: 1px dashed var(--pill-color), but jsdom doesn't apply scoped
    // CSS so we assert the class is present (the class is what selects the
    // rule) and that the inline --pill-color is the only color knob — i.e.
    // we do NOT also stamp background-color inline, which would clobber the
    // rule.
    const wrapper = mount(PillSegment, {
      props: { templateName: "PUSH A", phase: "too_soon", isProposed: false },
    });
    const pill = wrapper.find(".pill");
    expect(pill.classes()).toContain("too_soon");
    const style = pill.attributes("style") ?? "";
    expect(style).not.toContain("background-color");
    expect(style).not.toContain("background:");
  });

  it("exposes the four expected phase classes through a sample render", () => {
    // Sanity: each phase string round-trips into the rendered class list.
    // Mirrors the first test but pinned to a specific name → easy regression
    // hook if a phase value is ever renamed.
    const expected: Phase[] = ["too_soon", "acceptable", "prime", "in_window"];
    const seen = expected.map((phase) => {
      const w = mount(PillSegment, {
        props: { templateName: "LEGS A", phase, isProposed: false },
      });
      return w
        .find(".pill")
        .classes()
        .find((c) => expected.includes(c as Phase));
    });
    expect(seen).toEqual(expected);
  });
});
