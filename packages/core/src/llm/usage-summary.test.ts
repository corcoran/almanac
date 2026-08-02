import { describe, expect, it } from "vitest";
import { computeDailyBalance, DEFAULT_AVG_TOKENS_BY_FEATURE } from "./usage-summary.js";

const base = {
  tokensUsedToday: 0,
  callsToday: 0,
  recentAvgTokensPerCall: 2000,
  softLimitTokens: 50000,
  hardCapTokens: 500000,
  resetsAtLabel: "4am",
};

describe("computeDailyBalance", () => {
  it("computes logs-left from (softLimit - used) / (avgPerLog × 1.2 padding), floored", () => {
    const b = computeDailyBalance({ ...base, tokensUsedToday: 10000, callsToday: 5 });
    // (50000 - 10000) / (2000 × 1.2) = 40000 / 2400 = 16.67 → 16 (padded, conservative)
    expect(b.logsLeftEstimate).toBe(16);
    expect(b.tokensUsed).toBe(10000);
    expect(b.softLimit).toBe(50000);
    // The REPORTED avg stays the raw average (the detail line shows real usage),
    // only the logs-left divisor is padded.
    expect(b.avgTokensPerLog).toBe(2000);
  });

  it("over-estimates token use (padded divisor) so the count runs conservative", () => {
    // Without padding, 40000/2000 = 20 logs. With the ×1.2 pad it reports 16 —
    // fewer logs than the raw average implies, so the user isn't surprised by
    // running out. The token meter + soft limit stay exact (assert tokensUsed).
    const b = computeDailyBalance({ ...base, tokensUsedToday: 10000 });
    expect(b.logsLeftEstimate).toBe(16);
    expect(b.tokensUsed).toBe(10000); // exact, unpadded
  });

  it("computes pctRemaining of the soft limit", () => {
    const b = computeDailyBalance({ ...base, tokensUsedToday: 10000 });
    expect(b.pctRemaining).toBe(80); // (50000-10000)/50000
  });

  it("clamps logs-left and pct to 0 past the soft limit (never negative)", () => {
    const b = computeDailyBalance({ ...base, tokensUsedToday: 60000, callsToday: 30 });
    expect(b.logsLeftEstimate).toBe(0);
    expect(b.pctRemaining).toBe(0);
    expect(b.overSoftLimit).toBe(true);
  });

  it("falls back to a sane avg when the user has no history", () => {
    const b = computeDailyBalance({ ...base, recentAvgTokensPerCall: null, tokensUsedToday: 0 });
    // 50000 / (2000 DEFAULT × 1.2) = 50000 / 2400 = 20.83 → 20
    expect(b.logsLeftEstimate).toBe(20);
    expect(b.avgTokensPerLog).toBeGreaterThan(0);
  });

  it("returns null logsLeft + null softLimit when there is no soft limit", () => {
    const b = computeDailyBalance({ ...base, softLimitTokens: null, tokensUsedToday: 9999 });
    expect(b.logsLeftEstimate).toBeNull();
    expect(b.softLimit).toBeNull();
    expect(b.overSoftLimit).toBe(false);
  });

  it("flags overHardCap when used >= hardCap", () => {
    const b = computeDailyBalance({ ...base, tokensUsedToday: 500000, hardCapTokens: 500000 });
    expect(b.overHardCap).toBe(true);
  });

  it("overHardCap is false when no hard cap is set", () => {
    const b = computeDailyBalance({ ...base, tokensUsedToday: 9_999_999, hardCapTokens: null });
    expect(b.overHardCap).toBe(false);
  });

  it("surfaces callsToday and resetsAt for the detail line", () => {
    const b = computeDailyBalance({ ...base, callsToday: 9, tokensUsedToday: 18000 });
    expect(b.callsToday).toBe(9);
    expect(b.resetsAt).toBe("4am");
  });
});

it("per-feature default token costs reflect observed prod averages", () => {
  expect(DEFAULT_AVG_TOKENS_BY_FEATURE.meal_chat).toBe(1000);
  expect(DEFAULT_AVG_TOKENS_BY_FEATURE.insights_chat).toBe(5000);
});
