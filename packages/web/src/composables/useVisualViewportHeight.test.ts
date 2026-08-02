import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { useVisualViewportHeight } from "./useVisualViewportHeight.js";

/** Minimal stub of the VisualViewport object with a fire-able resize event. */
function makeViewport(initialHeight: number, initialOffsetTop = 0) {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    height: initialHeight,
    offsetTop: initialOffsetTop,
    addEventListener: vi.fn((type: string, cb: () => void) => {
      const existing = listeners[type] ?? [];
      existing.push(cb);
      listeners[type] = existing;
    }),
    removeEventListener: vi.fn((type: string, cb: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb);
    }),
    fire(type: string) {
      for (const cb of listeners[type] ?? []) cb();
    },
  };
}

/** Mount a throwaway component that exposes the composable's reactive state. */
function harness() {
  const Comp = defineComponent({
    setup() {
      return useVisualViewportHeight();
    },
    render: () => null,
  });
  return mount(Comp);
}

describe("useVisualViewportHeight", () => {
  const originalVV = window.visualViewport;

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: originalVV,
    });
  });

  it("seeds height + offsetTop from the visual viewport and reports supported", () => {
    const vp = makeViewport(640, 0);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vp });
    const wrapper = harness();
    expect(wrapper.vm.supported).toBe(true);
    expect(wrapper.vm.height).toBe(640);
    expect(wrapper.vm.offsetTop).toBe(0);
  });

  it("updates height + offsetTop when the visual viewport changes (keyboard opens)", async () => {
    const vp = makeViewport(640, 0);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vp });
    const wrapper = harness();
    expect(wrapper.vm.height).toBe(640);
    // Simulate the soft keyboard opening: visual viewport shrinks and shifts.
    vp.height = 360;
    vp.offsetTop = 40;
    vp.fire("resize");
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.height).toBe(360);
    expect(wrapper.vm.offsetTop).toBe(40);
  });

  it("tracks offsetTop via the scroll event (keyboard shifts without resizing)", async () => {
    const vp = makeViewport(640, 0);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vp });
    const wrapper = harness();
    vp.offsetTop = 25;
    vp.fire("scroll");
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.offsetTop).toBe(25);
  });

  it("falls back to innerHeight and reports unsupported when visualViewport is absent", () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 812 });
    const wrapper = harness();
    expect(wrapper.vm.supported).toBe(false);
    expect(wrapper.vm.height).toBe(812);
    expect(wrapper.vm.offsetTop).toBe(0);
  });
});
