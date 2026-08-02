import type { LlmConfig } from "@almanac/core/llm";
import { describe, expect, it } from "vitest";
import { ApiError } from "./errors.js";
import { assertLlmEnabled } from "./llm-gate.js";

const onCfg: LlmConfig = {
  enabled: true,
  provider: "anthropic",
  model: "claude-haiku-4-5",
  insightsModel: "claude-sonnet-4-6",
  apiKey: "sk-test",
  defaultDailyTokenLimit: undefined,
  hardDailyTokenCap: undefined,
  tokensPerSearch: 2500,
  hardDailySearchCap: undefined,
};

describe("assertLlmEnabled", () => {
  it("passes when all three conditions hold", () => {
    expect(() => assertLlmEnabled(onCfg, { llm_logging_enabled: 1 })).not.toThrow();
  });

  it("throws 403 when the master switch is off", () => {
    expect(() =>
      assertLlmEnabled({ ...onCfg, enabled: false }, { llm_logging_enabled: 1 }),
    ).toThrow(ApiError);
  });

  it("throws 403 when the api key is missing", () => {
    expect(() =>
      assertLlmEnabled({ ...onCfg, apiKey: undefined }, { llm_logging_enabled: 1 }),
    ).toThrow(ApiError);
  });

  it("throws 403 when the per-user flag is off", () => {
    expect(() => assertLlmEnabled(onCfg, { llm_logging_enabled: 0 })).toThrow(ApiError);
  });
});
