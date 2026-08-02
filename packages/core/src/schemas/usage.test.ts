import { describe, expect, it } from "vitest";
import { DailyBalanceSchema } from "./usage.js";

describe("DailyBalanceSchema", () => {
  it("parses a full balance", () => {
    const b = DailyBalanceSchema.parse({
      tokensUsed: 10000,
      callsToday: 5,
      softLimit: 50000,
      avgTokensPerLog: 2000,
      logsLeftEstimate: 20,
      pctRemaining: 80,
      overSoftLimit: false,
      overHardCap: false,
      resetsAt: "4am",
    });
    expect(b.logsLeftEstimate).toBe(20);
  });

  it("allows null softLimit / logsLeftEstimate / pctRemaining (no-limit case)", () => {
    const b = DailyBalanceSchema.parse({
      tokensUsed: 10000,
      callsToday: 5,
      softLimit: null,
      avgTokensPerLog: 2000,
      logsLeftEstimate: null,
      pctRemaining: null,
      overSoftLimit: false,
      overHardCap: false,
      resetsAt: "4am",
    });
    expect(b.softLimit).toBeNull();
  });
});
