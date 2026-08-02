import { describe, expect, it } from "vitest";
import { makeAggregate } from "./aggregate.js";

describe("makeAggregate", () => {
  it("returns value/window_days/days_with_data", () => {
    expect(makeAggregate(1658, 7, 5)).toEqual({
      value: 1658,
      window_days: 7,
      days_with_data: 5,
    });
  });

  it("returns zero-data shape (not null) when days_with_data=0", () => {
    expect(makeAggregate(0, 7, 0)).toEqual({
      value: 0,
      window_days: 7,
      days_with_data: 0,
    });
  });

  it("rounds the value to an integer by default", () => {
    expect(makeAggregate(1657.6, 7, 5).value).toBe(1658);
  });

  it("can pass through floats when round=false", () => {
    expect(makeAggregate(7.62, 7, 6, { round: false }).value).toBe(7.62);
  });
});
