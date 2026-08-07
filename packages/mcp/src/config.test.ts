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
      ALMANAC_MCP_OAUTH_CLIENT_ID: "client-id",
      ALMANAC_MCP_OAUTH_CLIENT_SECRET: "secret",
      ALMANAC_MCP_OIDC_ISSUER: "https://accounts.google.com",
    });
    expect(cfg.ALMANAC_MCP_PUBLIC_URL).toBe("https://almanac.example.com");
    expect(() =>
      loadConfig({
        ...baseEnv,
        ALMANAC_MCP_PUBLIC_URL: "not-a-url",
        ALMANAC_MCP_OAUTH_CLIENT_ID: "client-id",
        ALMANAC_MCP_OAUTH_CLIENT_SECRET: "secret",
        ALMANAC_MCP_OIDC_ISSUER: "https://accounts.google.com",
      }),
    ).toThrow();
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

describe("OIDC config", () => {
  const httpEnv = { ...baseEnv, ALMANAC_MCP_TRANSPORT: "http" as const };

  it("defaults the callback path to /oauth/callback", () => {
    const cfg = loadConfig(httpEnv);
    expect(cfg.ALMANAC_MCP_OAUTH_CALLBACK_PATH).toBe("/oauth/callback");
  });

  it(`treats a blank issuer as undefined (compose passes \${VAR:-})`, () => {
    const cfg = loadConfig({ ...httpEnv, ALMANAC_MCP_OIDC_ISSUER: "" });
    expect(cfg.ALMANAC_MCP_OIDC_ISSUER).toBeUndefined();
  });

  it("rejects a callback path that does not start with /", () => {
    expect(() =>
      loadConfig({ ...httpEnv, ALMANAC_MCP_OAUTH_CALLBACK_PATH: "oauth/callback" }),
    ).toThrow();
  });

  it("rejects a callback path carrying a query string", () => {
    expect(() =>
      loadConfig({ ...httpEnv, ALMANAC_MCP_OAUTH_CALLBACK_PATH: "/oauth/callback?x=1" }),
    ).toThrow();
  });

  it("rejects a callback path with a trailing slash", () => {
    expect(() =>
      loadConfig({ ...httpEnv, ALMANAC_MCP_OAUTH_CALLBACK_PATH: "/oauth/callback/" }),
    ).toThrow();
  });

  it("rejects a callback path starting with // (protocol-relative, not a path)", () => {
    expect(() =>
      loadConfig({ ...httpEnv, ALMANAC_MCP_OAUTH_CALLBACK_PATH: "//evil.com" }),
    ).toThrow();
  });

  it("rejects a callback path containing a .. segment", () => {
    // Express registers the literal string, but the browser normalizes the
    // IdP's redirect target to /x — so the callback route 404s at login.
    expect(() =>
      loadConfig({ ...httpEnv, ALMANAC_MCP_OAUTH_CALLBACK_PATH: "/oauth/../../x" }),
    ).toThrow();
  });

  it("still accepts a legitimate nested callback path", () => {
    const cfg = loadConfig({
      ...httpEnv,
      ALMANAC_MCP_OAUTH_CALLBACK_PATH: "/oauth/keycloak/callback",
    });
    expect(cfg.ALMANAC_MCP_OAUTH_CALLBACK_PATH).toBe("/oauth/keycloak/callback");
  });

  it("accepts a path segment containing dots that is not a .. segment", () => {
    const cfg = loadConfig({ ...httpEnv, ALMANAC_MCP_OAUTH_CALLBACK_PATH: "/oauth/v1.0/cb" });
    expect(cfg.ALMANAC_MCP_OAUTH_CALLBACK_PATH).toBe("/oauth/v1.0/cb");
  });

  it("rejects partial OAuth configuration — client id set but issuer missing", () => {
    // Half-configured must fail loudly at boot, not silently degrade to
    // PAT-only, which looks identical to an intentional PAT-only deploy.
    expect(() =>
      loadConfig({
        ...httpEnv,
        ALMANAC_MCP_OAUTH_CLIENT_ID: "almanac-mcp",
        ALMANAC_MCP_OAUTH_CLIENT_SECRET: "s3cret",
        ALMANAC_MCP_PUBLIC_URL: "https://almanac.example.com",
      }),
    ).toThrow(/ALMANAC_MCP_OIDC_ISSUER/);
  });

  it("accepts a fully-specified OAuth configuration", () => {
    const cfg = loadConfig({
      ...httpEnv,
      ALMANAC_MCP_OAUTH_CLIENT_ID: "almanac-mcp",
      ALMANAC_MCP_OAUTH_CLIENT_SECRET: "s3cret",
      ALMANAC_MCP_PUBLIC_URL: "https://almanac.example.com",
      ALMANAC_MCP_OIDC_ISSUER: "https://accounts.google.com",
    });
    expect(cfg.ALMANAC_MCP_OIDC_ISSUER).toBe("https://accounts.google.com");
  });

  it("accepts all four OAuth vars absent (PAT-only mode)", () => {
    expect(() => loadConfig(httpEnv)).not.toThrow();
  });

  it("accepts all four OAuth vars as blank strings (compose unset case — PAT-only)", () => {
    const cfg = loadConfig({
      ...httpEnv,
      ALMANAC_MCP_OAUTH_CLIENT_ID: "",
      ALMANAC_MCP_OAUTH_CLIENT_SECRET: "",
      ALMANAC_MCP_PUBLIC_URL: "",
      ALMANAC_MCP_OIDC_ISSUER: "",
    });
    expect(cfg.ALMANAC_MCP_OAUTH_CLIENT_ID).toBeUndefined();
    expect(cfg.ALMANAC_MCP_OAUTH_CLIENT_SECRET).toBeUndefined();
    expect(cfg.ALMANAC_MCP_PUBLIC_URL).toBeUndefined();
    expect(cfg.ALMANAC_MCP_OIDC_ISSUER).toBeUndefined();
  });

  it("accepts mixed blank and absent OAuth vars (still PAT-only)", () => {
    const cfg = loadConfig({
      ...httpEnv,
      ALMANAC_MCP_OAUTH_CLIENT_ID: "",
      // CLIENT_SECRET intentionally omitted
      ALMANAC_MCP_PUBLIC_URL: "",
      // ISSUER intentionally omitted
    });
    expect(cfg.ALMANAC_MCP_OAUTH_CLIENT_ID).toBeUndefined();
    expect(cfg.ALMANAC_MCP_OAUTH_CLIENT_SECRET).toBeUndefined();
    expect(cfg.ALMANAC_MCP_PUBLIC_URL).toBeUndefined();
    expect(cfg.ALMANAC_MCP_OIDC_ISSUER).toBeUndefined();
  });

  it("rejects blank CLIENT_ID alongside three real OAuth values", () => {
    expect(() =>
      loadConfig({
        ...httpEnv,
        ALMANAC_MCP_OAUTH_CLIENT_ID: "",
        ALMANAC_MCP_OAUTH_CLIENT_SECRET: "s3cret",
        ALMANAC_MCP_PUBLIC_URL: "https://almanac.example.com",
        ALMANAC_MCP_OIDC_ISSUER: "https://accounts.google.com",
      }),
    ).toThrow(/ALMANAC_MCP_OAUTH_CLIENT_ID/);
  });
});
