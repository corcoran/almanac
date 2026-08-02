import { describe, expect, it, vi } from "vitest";
import { at, defined, nthCall } from "./assertions.js";

describe("defined", () => {
  it("returns the value when present", () => {
    expect(defined(5, "x")).toBe(5);
  });
  it("throws when undefined/null", () => {
    expect(() => defined(undefined, "missing x")).toThrow(/missing x/);
    expect(() => defined(null, "missing y")).toThrow(/missing y/);
  });
});

describe("at", () => {
  it("returns the element at index", () => {
    expect(at([10, 20], 1)).toBe(20);
  });
  it("throws when out of bounds", () => {
    expect(() => at([10], 5)).toThrow(/index 5/);
  });
});

describe("nthCall", () => {
  it("returns the nth call's argument tuple", () => {
    const fn = vi.fn();
    fn("a", 1);
    fn("b", 2);
    expect(nthCall(fn, 0)).toEqual(["a", 1]);
    expect(nthCall(fn, 1)).toEqual(["b", 2]);
  });
  it("throws when the call did not happen", () => {
    const fn = vi.fn();
    expect(() => nthCall(fn, 0)).toThrow(/call 0/);
  });
});
