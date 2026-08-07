import { describe, expect, it } from "vitest";
import { loadLlmConfig } from "./config.js";

describe("loadLlmConfig", () => {
  it("defaults: disabled, anthropic provider, haiku model", () => {
    const c = loadLlmConfig({});
    expect(c.enabled).toBe(false);
    expect(c.provider).toBe("anthropic");
    expect(c.model).toBe("claude-haiku-4-5");
    expect(c.apiKey).toBeUndefined();
  });

  it("reads enabled flag and api key", () => {
    const c = loadLlmConfig({
      ALMANAC_LLM_ENABLED: "true",
      ANTHROPIC_API_KEY: "sk-test",
    });
    expect(c.enabled).toBe(true);
    expect(c.apiKey).toBe("sk-test");
  });

  it("throws when provider is not anthropic (reserved seam, validated only)", () => {
    expect(() => loadLlmConfig({ ALMANAC_LLM_PROVIDER: "openai" })).toThrow(/ALMANAC_LLM_PROVIDER/);
  });

  it("honors a model override", () => {
    const c = loadLlmConfig({ ALMANAC_LLM_MODEL: "claude-sonnet-4-6" });
    expect(c.model).toBe("claude-sonnet-4-6");
  });

  it("parses the default daily token limit when set", () => {
    const c = loadLlmConfig({ ALMANAC_LLM_DEFAULT_DAILY_TOKEN_LIMIT: "50000" });
    expect(c.defaultDailyTokenLimit).toBe(50000);
  });

  it("parses ALMANAC_LLM_HARD_DAILY_TOKEN_CAP into hardDailyTokenCap", () => {
    const cfg = loadLlmConfig({ ALMANAC_LLM_HARD_DAILY_TOKEN_CAP: "500000" } as NodeJS.ProcessEnv);
    expect(cfg.hardDailyTokenCap).toBe(500000);
  });
  it("leaves hardDailyTokenCap undefined when the env var is unset", () => {
    const cfg = loadLlmConfig({} as NodeJS.ProcessEnv);
    expect(cfg.hardDailyTokenCap).toBeUndefined();
  });

  it("parses ALMANAC_LLM_TOKENS_PER_SEARCH into tokensPerSearch (default 2500)", () => {
    expect(loadLlmConfig({}).tokensPerSearch).toBe(2500);
    expect(loadLlmConfig({ ALMANAC_LLM_TOKENS_PER_SEARCH: "4000" }).tokensPerSearch).toBe(4000);
  });

  it("parses ALMANAC_LLM_HARD_DAILY_SEARCH_CAP into hardDailySearchCap (undefined when unset)", () => {
    expect(loadLlmConfig({}).hardDailySearchCap).toBeUndefined();
    expect(loadLlmConfig({ ALMANAC_LLM_HARD_DAILY_SEARCH_CAP: "10" }).hardDailySearchCap).toBe(10);
  });

  it("insightsModel defaults to sonnet, independent of the (haiku) meal model", () => {
    const c = loadLlmConfig({});
    expect(c.insightsModel).toBe("claude-sonnet-4-6");
    expect(c.model).toBe("claude-haiku-4-5");
  });

  it("ALMANAC_LLM_INSIGHTS_MODEL overrides the insights model only", () => {
    const c = loadLlmConfig({ ALMANAC_LLM_INSIGHTS_MODEL: "claude-opus-4-8" });
    expect(c.insightsModel).toBe("claude-opus-4-8");
    expect(c.model).toBe("claude-haiku-4-5");
  });

  it("a blank ALMANAC_LLM_INSIGHTS_MODEL falls back to the sonnet default", () => {
    const c = loadLlmConfig({ ALMANAC_LLM_INSIGHTS_MODEL: "" });
    expect(c.insightsModel).toBe("claude-sonnet-4-6");
  });

  // docker-compose maps optional caps as `"${VAR:-}"`, so an UNSET var arrives
  // as an empty string, not absent. z.coerce.number() turns "" into 0, and the
  // `.positive()` guard then throws at boot, crashlooping the API. An empty
  // string must read as "unset", identical to the var being absent.
  it("treats an empty-string optional numeric var as unset (no crash on a blank compose default)", () => {
    const cfg = loadLlmConfig({
      ALMANAC_LLM_DEFAULT_DAILY_TOKEN_LIMIT: "",
      ALMANAC_LLM_HARD_DAILY_TOKEN_CAP: "",
      ALMANAC_LLM_HARD_DAILY_SEARCH_CAP: "",
      ALMANAC_LLM_TOKENS_PER_SEARCH: "",
    } as NodeJS.ProcessEnv);
    expect(cfg.defaultDailyTokenLimit).toBeUndefined();
    expect(cfg.hardDailyTokenCap).toBeUndefined();
    expect(cfg.hardDailySearchCap).toBeUndefined();
    // tokensPerSearch has a default — an empty string must fall back to it, not 0.
    expect(cfg.tokensPerSearch).toBe(2500);
  });
});
