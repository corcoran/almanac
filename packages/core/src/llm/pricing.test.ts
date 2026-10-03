import { describe, expect, it } from "vitest";
import { computeCostUsd } from "./pricing.js";

describe("computeCostUsd", () => {
  it("prices claude-haiku-4-5 with the 1h cache-write rate", () => {
    const cost = computeCostUsd("anthropic", "claude-haiku-4-5", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 1_000_000,
      cache_creation_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(1 + 5 + 0.1 + 2, 5);
  });

  it("prices claude-sonnet-5-5", () => {
    const cost = computeCostUsd("anthropic", "claude-sonnet-5-5", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 1_000_000,
      cache_creation_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(2 + 10 + 0.2 + 4, 5);
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
