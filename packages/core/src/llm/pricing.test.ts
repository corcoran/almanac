import { describe, expect, it } from "vitest";
import { computeCostUsd } from "./pricing.js";

describe("computeCostUsd", () => {
  it("prices haiku 4.5 across the four token buckets", () => {
    // Haiku 4.5: input $1.00/1M, output $5.00/1M.
    // cache read ~0.1x input ($0.10/1M); cache write ~1.25x input ($1.25/1M).
    const cost = computeCostUsd("anthropic", "claude-haiku-4-5", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 1_000_000,
      cache_creation_tokens: 1_000_000,
    });
    // 1.00 + 5.00 + 0.10 + 1.25 = 7.35
    expect(cost).toBeCloseTo(7.35, 5);
  });

  it("returns 0 for an all-zero usage", () => {
    expect(
      computeCostUsd("anthropic", "claude-haiku-4-5", {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      }),
    ).toBe(0);
  });

  it("throws on an unknown provider:model so cost is never silently wrong", () => {
    expect(() =>
      computeCostUsd("anthropic", "made-up-model", {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      }),
    ).toThrow(/no price/i);
  });
});
