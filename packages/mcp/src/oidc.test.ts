import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { ASYMMETRIC_ALGORITHMS, createOidcClient, validateIssuerUrl } from "./oidc.js";

const ISSUER = "https://idp.example.com";
const CLIENT_ID = "almanac-mcp";

async function harness() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  const discovery = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/auth`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/certs`,
    userinfo_endpoint: `${ISSUER}/userinfo`,
  };
  let discoveryHits = 0;
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      discoveryHits += 1;
      return new Response(JSON.stringify(discovery), { status: 200 });
    }
    if (url === discovery.jwks_uri) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const sign = (claims: Record<string, unknown>, alg = "RS256") =>
    new SignJWT(claims)
      .setProtectedHeader({ alg, kid: "test-key" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  return { fetchImpl, sign, discovery, hits: () => discoveryHits };
}

describe("validateIssuerUrl", () => {
  it("accepts an absolute https URL", () => {
    expect(validateIssuerUrl("https://idp.example.com")).toBe("https://idp.example.com");
  });

  it("strips a trailing slash so discovery URLs never double up", () => {
    expect(validateIssuerUrl("https://idp.example.com/")).toBe("https://idp.example.com");
  });

  it("rejects a non-absolute URL", () => {
    expect(() => validateIssuerUrl("idp.example.com")).toThrow(/absolute/i);
  });

  it("rejects a URL carrying a query string", () => {
    expect(() => validateIssuerUrl("https://idp.example.com?x=1")).toThrow(/query/i);
  });
});

describe("createOidcClient.endpoints", () => {
  it("resolves endpoints from the discovery document", async () => {
    const { fetchImpl } = await harness();
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    const ep = await client.endpoints();
    expect(ep.authorizationEndpoint).toBe(`${ISSUER}/auth`);
    expect(ep.tokenEndpoint).toBe(`${ISSUER}/token`);
    expect(ep.jwksUri).toBe(`${ISSUER}/certs`);
  });

  it("caches the document across calls", async () => {
    const { fetchImpl, hits } = await harness();
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    await client.endpoints();
    await client.endpoints();
    expect(hits()).toBe(1);
  });

  it("rejects a document whose issuer does not match the configured issuer", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ issuer: "https://evil.example.com" }), {
        status: 200,
      })) as typeof fetch;
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    await expect(client.endpoints()).rejects.toThrow(/issuer mismatch/i);
  });

  it("names the URL it tried when discovery fails", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    await expect(client.endpoints()).rejects.toThrow(
      /https:\/\/idp\.example\.com\/\.well-known\/openid-configuration/,
    );
  });
});

describe("createOidcClient.authorizationUrl", () => {
  it("builds against the discovered endpoint with the default scope", async () => {
    const { fetchImpl } = await harness();
    const client = createOidcClient({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: "s3cret",
      fetchImpl,
    });
    const url = await client.authorizationUrl({
      redirectUri: "https://almanac.example.com/oauth/callback",
      state: "st4te",
      codeChallenge: "cc",
    });
    expect(url.origin + url.pathname).toBe(`${ISSUER}/auth`);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("redirect_uri")).toBe("https://almanac.example.com/oauth/callback");
  });

  it("honours a configured scope (the offline_access seam)", async () => {
    const { fetchImpl } = await harness();
    const client = createOidcClient({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: "s3cret",
      scope: "openid email offline_access",
      fetchImpl,
    });
    const url = await client.authorizationUrl({
      redirectUri: "https://almanac.example.com/oauth/callback",
      state: "st4te",
    });
    expect(url.searchParams.get("scope")).toBe("openid email offline_access");
  });
});

describe("createOidcClient.exchangeCode", () => {
  it("POSTs to the discovered token endpoint with the client credentials", async () => {
    const { discovery } = await harness();
    const seen: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify(discovery), { status: 200 });
      }
      seen.push({ url, body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          id_token: "eyJ.stub.sig",
          access_token: "at",
          refresh_token: "rt",
          expires_in: 300,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const client = createOidcClient({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: "s3cret",
      fetchImpl,
    });
    const res = await client.exchangeCode({
      code: "auth-code",
      redirectUri: "https://almanac.example.com/oauth/callback",
    });

    const call = seen[0];
    if (call === undefined) throw new Error("token endpoint was not called");
    expect(call.url).toBe(`${ISSUER}/token`);
    expect(call.body).toContain("grant_type=authorization_code");
    expect(call.body).toContain("code=auth-code");
    expect(call.body).toContain("client_id=almanac-mcp");

    // The whole response is surfaced, not just the fields used today —
    // refresh_token/expires_in must already flow through.
    expect(res.idToken).toBe("eyJ.stub.sig");
    expect(res.refreshToken).toBe("rt");
    expect(res.expiresIn).toBe(300);
  });

  it("throws with the status and body when the token endpoint fails", async () => {
    const { discovery } = await harness();
    const fetchImpl = (async (input: string | URL) => {
      if (String(input).endsWith("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify(discovery), { status: 200 });
      }
      return new Response("invalid_grant", { status: 400 });
    }) as typeof fetch;
    const client = createOidcClient({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: "s3cret",
      fetchImpl,
    });
    await expect(client.exchangeCode({ code: "bad", redirectUri: "https://x/cb" })).rejects.toThrow(
      /400|invalid_grant/,
    );
  });

  it("redacts the client secret if an upstream error body echoes it back", async () => {
    // Some IdPs, gateways, and WAFs echo request parameters in error bodies.
    // The thrown error must not leak client_secret into logs/responses.
    const { discovery } = await harness();
    const secret = "s3cret";
    const fetchImpl = (async (input: string | URL) => {
      if (String(input).endsWith("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify(discovery), { status: 200 });
      }
      return new Response(`invalid_grant: client_secret=${secret} was rejected`, { status: 400 });
    }) as typeof fetch;
    const client = createOidcClient({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: secret,
      fetchImpl,
    });

    let caught: unknown;
    try {
      await client.exchangeCode({ code: "bad", redirectUri: "https://x/cb" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : "";
    expect(message).not.toContain(secret);
    expect(message).toContain("400");
  });

  it("truncates an oversized error body", async () => {
    const { discovery } = await harness();
    const hugeBody = "x".repeat(10_000);
    const fetchImpl = (async (input: string | URL) => {
      if (String(input).endsWith("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify(discovery), { status: 200 });
      }
      return new Response(hugeBody, { status: 500 });
    }) as typeof fetch;
    const client = createOidcClient({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: "s3cret",
      fetchImpl,
    });

    let caught: unknown;
    try {
      await client.exchangeCode({ code: "bad", redirectUri: "https://x/cb" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : "";
    expect(message.length).toBeLessThan(hugeBody.length);
  });
});

describe("createOidcClient.verifyIdToken", () => {
  it("accepts a correctly signed token and returns the email", async () => {
    const { fetchImpl, sign } = await harness();
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    const token = await sign({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: "user-1",
      email: "a@example.com",
      email_verified: true,
    });
    await expect(client.verifyIdToken(token)).resolves.toEqual({
      email: "a@example.com",
      sub: "user-1",
    });
  });

  it("rejects a tampered payload", async () => {
    const { fetchImpl, sign } = await harness();
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    const token = await sign({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: "user-1",
      email: "a@example.com",
      email_verified: true,
    });
    const parts = token.split(".");
    const header = parts[0];
    const signature = parts[2];
    if (header === undefined || signature === undefined) throw new Error("bad test token");
    const forged = Buffer.from(
      JSON.stringify({
        iss: ISSUER,
        aud: CLIENT_ID,
        sub: "user-1",
        email: "attacker@example.com",
        email_verified: true,
      }),
    ).toString("base64url");
    await expect(client.verifyIdToken(`${header}.${forged}.${signature}`)).rejects.toThrow();
  });

  it("rejects a wrong issuer", async () => {
    const { fetchImpl, sign } = await harness();
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    const token = await sign({
      iss: "https://evil.example.com",
      aud: CLIENT_ID,
      sub: "u",
      email: "a@example.com",
      email_verified: true,
    });
    await expect(client.verifyIdToken(token)).rejects.toThrow();
  });

  it("rejects a wrong audience", async () => {
    const { fetchImpl, sign } = await harness();
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    const token = await sign({
      iss: ISSUER,
      aud: "some-other-client",
      sub: "u",
      email: "a@example.com",
      email_verified: true,
    });
    await expect(client.verifyIdToken(token)).rejects.toThrow();
  });

  it("never accepts a symmetric signing algorithm", () => {
    // Direct assertion on the allow-list itself. The behavioural HS256 test
    // below is NOT sufficient alone: jose's own JWKS-vs-alg check throws
    // before the allow-list is ever consulted, so a bare `.rejects.toThrow()`
    // (or even a /alg/i matcher, since jose's own error text contains "alg")
    // still passes even if HS256 were added back to ASYMMETRIC_ALGORITHMS.
    // This assertion is the one that actually goes red on that mutation.
    expect(ASYMMETRIC_ALGORITHMS.some((alg) => alg.startsWith("HS"))).toBe(false);
  });

  it("rejects an HS256-signed token (JWT confusion guard)", async () => {
    // Keycloak advertises HS256 in id_token_signing_alg_values_supported.
    // Accepting a symmetric alg against a JWKS key set is a known attack.
    const { fetchImpl } = await harness();
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    const secret = new TextEncoder().encode("a".repeat(32));
    const token = await new SignJWT({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: "u",
      email: "a@example.com",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(secret);
    await expect(client.verifyIdToken(token)).rejects.toThrow();
  });

  it("rejects email_verified: false", async () => {
    const { fetchImpl, sign } = await harness();
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    const token = await sign({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: "u",
      email: "a@example.com",
      email_verified: false,
    });
    await expect(client.verifyIdToken(token)).rejects.toThrow(/verified/i);
  });

  it("rejects a token with no email claim and no access token for the fallback", async () => {
    const { fetchImpl, sign } = await harness();
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    const token = await sign({ iss: ISSUER, aud: CLIENT_ID, sub: "u", email_verified: true });
    await expect(client.verifyIdToken(token)).rejects.toThrow(/email/i);
  });
});

describe("createOidcClient.verifyIdToken — userinfo fallback", () => {
  // Some OIDC issuers legitimately omit `email` from the ID token (OIDC Core
  // leaves it to the issuer's discretion). Without this fallback such an
  // issuer cannot authenticate at all.
  //
  // Wraps the base harness so the userinfo endpoint returns a caller-supplied
  // body, and records the Authorization header it was called with.
  async function userinfoHarness(userinfo: unknown, status = 200) {
    const base = await harness();
    const userinfoCalls: Array<{ authorization: string | null }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      if (String(input) === `${ISSUER}/userinfo`) {
        userinfoCalls.push({
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return new Response(JSON.stringify(userinfo), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
      return base.fetchImpl(input, init);
    }) as typeof fetch;
    return { ...base, fetchImpl, userinfoCalls };
  }

  const noEmailToken = (sign: Awaited<ReturnType<typeof harness>>["sign"]) =>
    sign({ iss: ISSUER, aud: CLIENT_ID, sub: "user-1" });

  it("resolves the email from userinfo when the sub matches", async () => {
    const { fetchImpl, sign, userinfoCalls } = await userinfoHarness({
      sub: "user-1",
      email: "a@example.com",
      email_verified: true,
    });
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    await expect(
      client.verifyIdToken(await noEmailToken(sign), { accessToken: "upstream-at" }),
    ).resolves.toEqual({ email: "a@example.com", sub: "user-1" });
    // Presented as a bearer token, not smuggled in the query string.
    expect(userinfoCalls).toEqual([{ authorization: "Bearer upstream-at" }]);
  });

  it("rejects a userinfo response whose sub does NOT match the verified id_token", async () => {
    // The security core of the fallback: the userinfo body carries no
    // signature of its own, so the sub match is its only binding to the
    // identity we cryptographically verified.
    const { fetchImpl, sign } = await userinfoHarness({
      sub: "someone-else",
      email: "attacker@evil.example",
      email_verified: true,
    });
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    await expect(
      client.verifyIdToken(await noEmailToken(sign), { accessToken: "upstream-at" }),
    ).rejects.toThrow(/sub/i);
  });

  it("rejects a userinfo response with no sub at all", async () => {
    const { fetchImpl, sign } = await userinfoHarness({
      email: "a@example.com",
      email_verified: true,
    });
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    await expect(
      client.verifyIdToken(await noEmailToken(sign), { accessToken: "upstream-at" }),
    ).rejects.toThrow(/sub/i);
  });

  it("rejects userinfo with email_verified false", async () => {
    const { fetchImpl, sign } = await userinfoHarness({
      sub: "user-1",
      email: "a@example.com",
      email_verified: false,
    });
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    await expect(
      client.verifyIdToken(await noEmailToken(sign), { accessToken: "upstream-at" }),
    ).rejects.toThrow(/verified/i);
  });

  it("rejects a non-2xx userinfo response", async () => {
    const { fetchImpl, sign } = await userinfoHarness({ error: "invalid_token" }, 401);
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    await expect(
      client.verifyIdToken(await noEmailToken(sign), { accessToken: "upstream-at" }),
    ).rejects.toThrow(/401/);
  });

  it("does not call userinfo when the id_token already carries a verified email", async () => {
    const { fetchImpl, sign, userinfoCalls } = await userinfoHarness({
      sub: "user-1",
      email: "from-userinfo@example.com",
      email_verified: true,
    });
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID, fetchImpl });
    const token = await sign({
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: "user-1",
      email: "from-idtoken@example.com",
      email_verified: true,
    });
    await expect(client.verifyIdToken(token, { accessToken: "upstream-at" })).resolves.toEqual({
      email: "from-idtoken@example.com",
      sub: "user-1",
    });
    expect(userinfoCalls).toHaveLength(0);
  });
});
