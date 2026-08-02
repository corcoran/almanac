import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const baseEnv = {
  ALMANAC_API_URL: "http://127.0.0.1:3001",
};

describe("loadConfig", () => {
  it("stdio without ALMANAC_MCP_CLIENT_TOKEN rejects with a helpful message", () => {
    // stdio mode threads ALMANAC_MCP_CLIENT_TOKEN to API calls directly —
    // there's no incoming HTTP request to extract a bearer from — so the
    // env var IS required here.
    expect(() => loadConfig({ ...baseEnv, ALMANAC_MCP_TRANSPORT: "stdio" })).toThrow(
      /ALMANAC_MCP_CLIENT_TOKEN is required/,
    );
  });

  it("stdio with a sufficiently-long ALMANAC_MCP_CLIENT_TOKEN parses successfully", () => {
    const cfg = loadConfig({
      ...baseEnv,
      ALMANAC_MCP_TRANSPORT: "stdio",
      ALMANAC_MCP_CLIENT_TOKEN: "this-is-long-enough",
    });
    expect(cfg.ALMANAC_MCP_TRANSPORT).toBe("stdio");
    expect(cfg.ALMANAC_MCP_CLIENT_TOKEN).toBe("this-is-long-enough");
  });

  it("sse without ALMANAC_MCP_CLIENT_TOKEN parses successfully (env var unread in http/sse)", () => {
    const cfg = loadConfig({ ...baseEnv, ALMANAC_MCP_TRANSPORT: "sse" });
    expect(cfg.ALMANAC_MCP_TRANSPORT).toBe("sse");
    expect(cfg.ALMANAC_MCP_CLIENT_TOKEN).toBeUndefined();
  });

  it("empty ALMANAC_MCP_PUBLIC_URL parses as undefined (blank = OAuth disabled)", () => {
    // docker-compose passes `${ALMANAC_MCP_PUBLIC_URL:-}`, which is "" when
    // unset. Per the OAuth gate in index.ts a blank value means PAT-only mode,
    // so "" must coerce to undefined rather than failing .url() validation.
    const cfg = loadConfig({
      ...baseEnv,
      ALMANAC_MCP_TRANSPORT: "http",
      ALMANAC_MCP_PUBLIC_URL: "",
    });
    expect(cfg.ALMANAC_MCP_PUBLIC_URL).toBeUndefined();
  });

  it("a real ALMANAC_MCP_PUBLIC_URL still validates as a URL", () => {
    const cfg = loadConfig({
      ...baseEnv,
      ALMANAC_MCP_TRANSPORT: "http",
      ALMANAC_MCP_PUBLIC_URL: "https://almanac.example.com",
    });
    expect(cfg.ALMANAC_MCP_PUBLIC_URL).toBe("https://almanac.example.com");
    expect(() => loadConfig({ ...baseEnv, ALMANAC_MCP_PUBLIC_URL: "not-a-url" })).toThrow();
  });

  it("sse with a short ALMANAC_MCP_CLIENT_TOKEN rejects via min(8)", () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        ALMANAC_MCP_TRANSPORT: "sse",
        ALMANAC_MCP_CLIENT_TOKEN: "short",
      }),
    ).toThrow();
  });

  it("sse with a sufficiently-long ALMANAC_MCP_CLIENT_TOKEN parses successfully", () => {
    const cfg = loadConfig({
      ...baseEnv,
      ALMANAC_MCP_TRANSPORT: "sse",
      ALMANAC_MCP_CLIENT_TOKEN: "this-is-long-enough",
    });
    expect(cfg.ALMANAC_MCP_CLIENT_TOKEN).toBe("this-is-long-enough");
  });

  it("defaults ALMANAC_MCP_TRANSPORT to http (Streamable HTTP)", () => {
    const cfg = loadConfig({
      ...baseEnv,
    });
    expect(cfg.ALMANAC_MCP_TRANSPORT).toBe("http");
  });

  it("http without ALMANAC_MCP_CLIENT_TOKEN parses successfully (env var unread in http/sse)", () => {
    const cfg = loadConfig({ ...baseEnv, ALMANAC_MCP_TRANSPORT: "http" });
    expect(cfg.ALMANAC_MCP_TRANSPORT).toBe("http");
    expect(cfg.ALMANAC_MCP_CLIENT_TOKEN).toBeUndefined();
  });

  it("http with a sufficiently-long ALMANAC_MCP_CLIENT_TOKEN parses successfully (token just isn't consumed)", () => {
    const cfg = loadConfig({
      ...baseEnv,
      ALMANAC_MCP_TRANSPORT: "http",
      ALMANAC_MCP_CLIENT_TOKEN: "this-is-long-enough",
    });
    expect(cfg.ALMANAC_MCP_TRANSPORT).toBe("http");
    expect(cfg.ALMANAC_MCP_CLIENT_TOKEN).toBe("this-is-long-enough");
  });
});
