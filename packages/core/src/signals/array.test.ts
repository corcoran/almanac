import { describe, expect, it, test } from "vitest";
import { first, last, median, requireNonEmpty } from "./array.js";

describe("array helpers", () => {
  it("first/last return the end elements", () => {
    expect(first([1, 2, 3])).toBe(1);
    expect(last([1, 2, 3])).toBe(3);
  });

  it("first/last return undefined for empty arrays", () => {
    expect(first([])).toBeUndefined();
    expect(last([])).toBeUndefined();
  });

  it("requireNonEmpty returns the array when non-empty", () => {
    const arr = requireNonEmpty([1], "test");
    expect(arr[0]).toBe(1);
  });

  it("requireNonEmpty throws with context when empty", () => {
    expect(() => requireNonEmpty([], "my context")).toThrow(/my context/);
  });
});

describe("median", () => {
  test("odd-length returns the middle element", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  test("even-length returns the mean of the two middle elements", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  test("single element returns itself", () => {
    expect(median([7])).toBe(7);
  });
  test("does not mutate the input array", () => {
    const xs: [number, ...number[]] = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});
