import { describe, expect, it } from "vitest";
import { DailyBalanceSchema } from "./usage.js";

describe("DailyBalanceSchema", () => {
  it("parses a full balance", () => {
    const b = DailyBalanceSchema.parse({
      tokensUsed: 10000,
      callsToday: 5,
      softLimit: 50000,
      hardCap: 150000,
      avgTokensPerLog: 2000,
      logsLeftEstimate: 20,
      pctRemaining: 80,
      hardLogsLeftEstimate: 58,
      hardPctRemaining: 93,
      overSoftLimit: false,
      overHardCap: false,
      resetsAt: "4am",
    });
    expect(b.logsLeftEstimate).toBe(20);
  });

  it("carries the hard-tier fields through to the client", () => {
    const b = DailyBalanceSchema.parse({
      tokensUsed: 60000,
      callsToday: 20,
      softLimit: 50000,
      hardCap: 150000,
      avgTokensPerLog: 2000,
      logsLeftEstimate: 0,
      pctRemaining: 0,
      hardLogsLeftEstimate: 37,
      hardPctRemaining: 60,
      overSoftLimit: true,
      overHardCap: false,
      resetsAt: "4am",
    });
    expect(b.hardCap).toBe(150000);
    expect(b.hardLogsLeftEstimate).toBe(37);
    expect(b.hardPctRemaining).toBe(60);
  });

  it("allows a null hard cap (no ceiling configured)", () => {
    const b = DailyBalanceSchema.parse({
      tokensUsed: 10000,
      callsToday: 5,
      softLimit: 50000,
      hardCap: null,
      avgTokensPerLog: 2000,
      logsLeftEstimate: 20,
      pctRemaining: 80,
      hardLogsLeftEstimate: null,
      hardPctRemaining: null,
      overSoftLimit: false,
      overHardCap: false,
      resetsAt: "4am",
    });
    expect(b.hardCap).toBeNull();
  });

  it("allows null softLimit / logsLeftEstimate / pctRemaining (no-limit case)", () => {
    const b = DailyBalanceSchema.parse({
      tokensUsed: 10000,
      callsToday: 5,
      softLimit: null,
      hardCap: null,
      avgTokensPerLog: 2000,
      logsLeftEstimate: null,
      pctRemaining: null,
      hardLogsLeftEstimate: null,
      hardPctRemaining: null,
      overSoftLimit: false,
      overHardCap: false,
      resetsAt: "4am",
    });
    expect(b.softLimit).toBeNull();
  });
});
