import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlmanacOAuthProvider } from "./oauth-provider.js";
import type { OidcClient } from "./oidc.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Captures every call made to the stub's exchangeCode, so tests can assert
// on what the provider actually sent (e.g. the redirect_uri byte-identity
// invariant) rather than just on the stub's canned return value.
let exchangeCodeCalls: Array<{ code: string; redirectUri: string; codeVerifier?: string }> = [];
// Captures every id_token handed to verifyIdToken, so tests can assert the
// provider actually routes through verification (rather than, say, reviving
// the base64-decode path) and that it forwards exactly what exchangeCode
// returned.
let verifyIdTokenCalls: string[] = [];
// When set, verifyIdToken rejects instead of returning a canned identity —
// lets tests assert that a rejecting verification blocks the flow.
let verifyIdTokenRejection: Error | undefined;

// A realistic-shaped (header.payload.signature) id_token whose payload
// decodes to an attacker-chosen email with no valid signature. Used so a
// reintroduced "decode without verifying" vulnerability is actually
// exercised by these tests, rather than tripping over an early throw on a
// token that doesn't even look like a JWT. The signature segment is
// deliberately garbage — verifyIdToken (real implementation) would reject
// this outright; only an unverified decode would ever trust it.
const STUB_ID_TOKEN = [
  Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
  Buffer.from(
    JSON.stringify({ email: "attacker@evil.example", email_verified: true, sub: "u1" }),
  ).toString("base64url"),
  "fakesig",
].join(".");

function resetOidcStubState() {
  exchangeCodeCalls = [];
  verifyIdTokenCalls = [];
  verifyIdTokenRejection = undefined;
}

const oidcStub: OidcClient = {
  endpoints: async () => ({
    issuer: "https://idp.example.com",
    authorizationEndpoint: "https://idp.example.com/auth",
    tokenEndpoint: "https://idp.example.com/token",
    jwksUri: "https://idp.example.com/certs",
    userinfoEndpoint: undefined,
  }),
  authorizationUrl: async ({ redirectUri, state, codeChallenge }) => {
    const u = new URL("https://idp.example.com/auth");
    u.searchParams.set("client_id", "almanac-mcp");
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "openid email");
    u.searchParams.set("state", state);
    if (codeChallenge !== undefined) {
      u.searchParams.set("code_challenge", codeChallenge);
      u.searchParams.set("code_challenge_method", "S256");
    }
    return u;
  },
  exchangeCode: async (opts) => {
    exchangeCodeCalls.push(opts);
    return {
      idToken: STUB_ID_TOKEN,
      accessToken: "at",
      refreshToken: undefined,
      expiresIn: 300,
      tokenType: "Bearer",
      scope: "openid email",
    };
  },
  verifyIdToken: async (idToken) => {
    verifyIdTokenCalls.push(idToken);
    if (verifyIdTokenRejection !== undefined) {
      throw verifyIdTokenRejection;
    }
    return { email: "a@example.com", sub: "u1" };
  },
};

function makeProvider(over: Partial<ConstructorParameters<typeof AlmanacOAuthProvider>[0]> = {}) {
  return new AlmanacOAuthProvider({
    publicBaseUrl: "https://almanac.example.com",
    callbackPath: "/oauth/callback",
    allowedEmails: new Set<string>(),
    apiUrl: "http://api.internal:3001",
    oidc: oidcStub,
    ...over,
  });
}

function fakeRes() {
  return {
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

const client = { client_id: "c1", client_name: "Test", redirect_uris: [] } as never;

describe("authorize", () => {
  it("redirects to the DISCOVERED authorization endpoint, not a hardcoded one", async () => {
    resetOidcStubState();
    const provider = makeProvider();
    const res = fakeRes();
    await provider.authorize(
      client,
      { codeChallenge: "cc", redirectUri: "https://client.example/cb", scopes: [] } as never,
      res as never,
    );
    const target = new URL(res.redirect.mock.calls[0]?.[0] as string);
    expect(target.origin + target.pathname).toBe("https://idp.example.com/auth");
    expect(target.searchParams.get("client_id")).toBe("almanac-mcp");
    expect(target.searchParams.get("redirect_uri")).toBe(
      "https://almanac.example.com/oauth/callback",
    );
    expect(target.searchParams.get("scope")).toContain("email");
  });
});

// Drive a full authorize → callback → code exchange, returning the minted code.
// `handleCallback` needs the state the provider generated, which it embeds in
// the redirect URL from authorize().
async function mintCode(provider: AlmanacOAuthProvider, redirectUri = "https://client.example/cb") {
  const authRes = fakeRes();
  await provider.authorize(
    client,
    { codeChallenge: "cc", redirectUri, scopes: ["mcp:tools"] } as never,
    authRes as never,
  );
  const target = new URL(authRes.redirect.mock.calls[0]?.[0] as string);
  const state = target.searchParams.get("state");
  if (state === null) throw new Error("authorize() did not set a state param");

  // No fetch stub needed here: the token exchange now goes through
  // oidcStub.exchangeCode, not an inline fetch in the provider.
  const cbRes = fakeRes();
  await provider.handleCallback({ code: "idp-code", state }, cbRes as never);
  const back = new URL(cbRes.redirect.mock.calls[0]?.[0] as string);
  const code = back.searchParams.get("code");
  if (code === null) throw new Error("handleCallback did not mint a code");
  return code;
}

describe("redirect_uri byte-identity invariant", () => {
  it("sends the exchange redirect_uri IDENTICAL to the one used in the authorization request", async () => {
    resetOidcStubState();
    const provider = makeProvider();
    const authRes = fakeRes();
    await provider.authorize(
      client,
      { codeChallenge: "cc", redirectUri: "https://client.example/cb", scopes: [] } as never,
      authRes as never,
    );
    const authUrl = new URL(authRes.redirect.mock.calls[0]?.[0] as string);
    const state = authUrl.searchParams.get("state");
    if (state === null) throw new Error("authorize() did not set a state param");

    const cbRes = fakeRes();
    await provider.handleCallback({ code: "idp-code", state }, cbRes as never);

    expect(exchangeCodeCalls).toHaveLength(1);
    expect(exchangeCodeCalls[0]?.redirectUri).toBe(authUrl.searchParams.get("redirect_uri"));
    expect(exchangeCodeCalls[0]?.redirectUri).toBe("https://almanac.example.com/oauth/callback");
  });
});

describe("upstream PKCE is an independent leg", () => {
  // The regression: the provider forwarded the DOWNSTREAM client's
  // params.codeChallenge to the IdP, then exchanged the upstream code with
  // no code_verifier at all. Almanac never holds the verifier matching the
  // downstream challenge, so per RFC 7636 §4.6 an IdP that received a
  // code_challenge MUST reject that exchange — breaking every OAuth login.
  //
  // Asserting merely "some verifier was passed" would NOT catch a
  // reintroduction that kept sending the downstream challenge upstream, so
  // this captures both halves and checks they are a real S256 pair.
  const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

  async function runFlow(downstreamChallenge: string) {
    resetOidcStubState();
    const provider = makeProvider();
    const authRes = fakeRes();
    await provider.authorize(
      client,
      {
        codeChallenge: downstreamChallenge,
        redirectUri: "https://client.example/cb",
        scopes: [],
      } as never,
      authRes as never,
    );
    const authUrl = new URL(authRes.redirect.mock.calls[0]?.[0] as string);
    const state = authUrl.searchParams.get("state");
    if (state === null) throw new Error("authorize() did not set a state param");

    const cbRes = fakeRes();
    await provider.handleCallback({ code: "idp-code", state }, cbRes as never);
    return { provider, authUrl, cbRes };
  }

  it("sends a challenge upstream whose verifier it presents at the token exchange", async () => {
    const { authUrl } = await runFlow("downstream-challenge");

    const sentChallenge = authUrl.searchParams.get("code_challenge");
    expect(sentChallenge).toEqual(expect.any(String));
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");

    expect(exchangeCodeCalls).toHaveLength(1);
    const sentVerifier = exchangeCodeCalls[0]?.codeVerifier;
    expect(sentVerifier).toEqual(expect.any(String));

    // The load-bearing assertion: the verifier we presented at the token
    // endpoint is the preimage of the challenge we sent to the authorize
    // endpoint. Fails if either half is missing OR if they don't correspond.
    if (sentVerifier === undefined) throw new Error("no upstream code_verifier was sent");
    expect(s256(sentVerifier)).toBe(sentChallenge);
  });

  it("never forwards the downstream client's challenge to the IdP", async () => {
    const downstream = "downstream-challenge";
    const { authUrl } = await runFlow(downstream);

    expect(authUrl.searchParams.get("code_challenge")).not.toBe(downstream);
    expect(exchangeCodeCalls[0]?.codeVerifier).not.toBe(downstream);
  });

  it("generates a fresh upstream verifier per flow", async () => {
    const first = await runFlow("cc");
    const firstVerifier = exchangeCodeCalls[0]?.codeVerifier;
    const second = await runFlow("cc");
    const secondVerifier = exchangeCodeCalls[0]?.codeVerifier;

    expect(firstVerifier).toEqual(expect.any(String));
    expect(secondVerifier).not.toBe(firstVerifier);
    expect(first.authUrl.searchParams.get("code_challenge")).not.toBe(
      second.authUrl.searchParams.get("code_challenge"),
    );
  });

  it("still stores the DOWNSTREAM challenge for the MCP client's own exchange", async () => {
    resetOidcStubState();
    const provider = makeProvider();
    const code = await mintCode(provider);
    // mintCode() authorizes with codeChallenge "cc" — the SDK must get that
    // back verbatim, not the upstream challenge.
    await expect(provider.challengeForAuthorizationCode(client, code)).resolves.toBe("cc");
  });
});

describe("pendingAuths expiry", () => {
  it("rejects a callback whose pending auth has aged out", async () => {
    resetOidcStubState();
    vi.useFakeTimers();
    try {
      const provider = makeProvider();
      const authRes = fakeRes();
      await provider.authorize(
        client,
        { codeChallenge: "cc", redirectUri: "https://client.example/cb", scopes: [] } as never,
        authRes as never,
      );
      const state = new URL(authRes.redirect.mock.calls[0]?.[0] as string).searchParams.get(
        "state",
      );
      if (state === null) throw new Error("authorize() did not set a state param");

      vi.advanceTimersByTime(11 * 60 * 1000); // pending auths live 10 minutes

      const cbRes = fakeRes();
      await provider.handleCallback({ code: "idp-code", state }, cbRes as never);
      expect(cbRes.status).toHaveBeenCalledWith(400);
      expect(cbRes.redirect).not.toHaveBeenCalled();
      // Nothing was exchanged upstream for an expired flow.
      expect(exchangeCodeCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sweeps abandoned pending auths instead of retaining them forever", async () => {
    // An abandoned flow (user closes the IdP consent screen) never reaches
    // handleCallback, so the success-path delete never runs. /authorize is
    // reachable pre-SSO, so without a sweep this map grows unboundedly.
    resetOidcStubState();
    vi.useFakeTimers();
    try {
      const provider = makeProvider();
      const abandonedRes = fakeRes();
      await provider.authorize(
        client,
        { codeChallenge: "cc", redirectUri: "https://client.example/cb", scopes: [] } as never,
        abandonedRes as never,
      );
      const abandonedState = new URL(
        abandonedRes.redirect.mock.calls[0]?.[0] as string,
      ).searchParams.get("state");
      if (abandonedState === null) throw new Error("authorize() did not set a state param");

      vi.advanceTimersByTime(11 * 60 * 1000);

      // A later authorize() sweeps the aged-out entry on write.
      await provider.authorize(
        client,
        { codeChallenge: "cc", redirectUri: "https://client.example/cb", scopes: [] } as never,
        fakeRes() as never,
      );

      // The swept state is gone entirely — indistinguishable from never-seen.
      const cbRes = fakeRes();
      await provider.handleCallback({ code: "idp-code", state: abandonedState }, cbRes as never);
      expect(cbRes.status).toHaveBeenCalledWith(400);
      expect(cbRes.json).toHaveBeenCalledWith({ error: "Unknown or expired state parameter" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("authorization codes", () => {
  it("rejects a code issued to a different client", async () => {
    resetOidcStubState();
    const provider = makeProvider();
    const code = await mintCode(provider);
    const otherClient = { ...(client as object), client_id: "c2" } as never;
    await expect(provider.exchangeAuthorizationCode(otherClient, code)).rejects.toThrow(
      /not issued to this client/i,
    );
  });

  it("rejects an expired code", async () => {
    resetOidcStubState();
    vi.useFakeTimers();
    try {
      const provider = makeProvider();
      const code = await mintCode(provider);
      vi.advanceTimersByTime(6 * 60 * 1000); // codes live 5 minutes
      await expect(provider.exchangeAuthorizationCode(client, code)).rejects.toThrow(/expired/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects reuse of a code (single-use)", async () => {
    resetOidcStubState();
    const provider = makeProvider();
    const code = await mintCode(provider);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: 7, token: "alm_abc" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await provider.exchangeAuthorizationCode(client, code);
    await expect(provider.exchangeAuthorizationCode(client, code)).rejects.toThrow(/invalid/i);
  });
});

describe("allowlist", () => {
  it("allows any verified email when the allowlist is empty", async () => {
    resetOidcStubState();
    const provider = makeProvider({ allowedEmails: new Set<string>() });
    await expect(mintCode(provider)).resolves.toEqual(expect.any(String));
  });

  it("rejects an email absent from a populated allowlist with 403", async () => {
    resetOidcStubState();
    const provider = makeProvider({ allowedEmails: new Set(["someone-else@example.com"]) });
    const authRes = fakeRes();
    await provider.authorize(
      client,
      { codeChallenge: "cc", redirectUri: "https://client.example/cb", scopes: [] } as never,
      authRes as never,
    );
    const state = new URL(authRes.redirect.mock.calls[0]?.[0] as string).searchParams.get("state");
    const cbRes = fakeRes();
    await provider.handleCallback({ code: "idp-code", state: state ?? "" }, cbRes as never);
    expect(cbRes.status).toHaveBeenCalledWith(403);
    expect(cbRes.redirect).not.toHaveBeenCalled();
  });
});

describe("id_token verification gates the flow", () => {
  it("calls verifyIdToken with exactly the id_token returned by exchangeCode", async () => {
    resetOidcStubState();
    const provider = makeProvider();
    await mintCode(provider);
    expect(verifyIdTokenCalls).toEqual([STUB_ID_TOKEN]);
  });

  it("a rejecting verifyIdToken produces a non-2xx response and mints no code", async () => {
    resetOidcStubState();
    verifyIdTokenRejection = new Error("signature verification failed");
    const provider = makeProvider();

    const authRes = fakeRes();
    await provider.authorize(
      client,
      { codeChallenge: "cc", redirectUri: "https://client.example/cb", scopes: [] } as never,
      authRes as never,
    );
    const state = new URL(authRes.redirect.mock.calls[0]?.[0] as string).searchParams.get("state");
    if (state === null) throw new Error("authorize() did not set a state param");

    const cbRes = fakeRes();
    await provider.handleCallback({ code: "idp-code", state }, cbRes as never);

    expect(cbRes.status).toHaveBeenCalledTimes(1);
    const [statusArg] = cbRes.status.mock.calls[0] ?? [];
    expect(statusArg).toBeGreaterThanOrEqual(400);
    expect(cbRes.redirect).not.toHaveBeenCalled();

    // No auth code was minted: exchanging any plausible code must fail,
    // since a rejected verification must never reach authCodes.set(...).
    await expect(provider.exchangeAuthorizationCode(client, "whatever-code")).rejects.toThrow(
      /invalid/i,
    );
  });
});

describe("revokeToken", () => {
  it("revokes the underlying PAT via the API, not just the in-memory map", async () => {
    // The bug being fixed: deleting from the Map alone is undone by
    // verifyAccessToken's API fallback on the very next request.
    resetOidcStubState();
    const provider = makeProvider();
    const code = await mintCode(provider);

    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method ?? "GET" });
        return new Response(JSON.stringify({ id: 42, token: "alm_abc" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const tokens = await provider.exchangeAuthorizationCode(client, code);
    await provider.revokeToken(client, { token: tokens.access_token } as never);

    expect(calls).toContainEqual({
      url: "http://api.internal:3001/api/v1/auth/tokens/42",
      method: "DELETE",
    });
  });

  it("does not throw when the PAT id is unknown (e.g. after a restart)", async () => {
    resetOidcStubState();
    const provider = makeProvider();
    await expect(
      provider.revokeToken(client, { token: "alm_never_seen" } as never),
    ).resolves.toBeUndefined();
  });

  it("throws and keeps the map entry when the API DELETE fails, so a retry can still resolve the id", async () => {
    resetOidcStubState();
    const provider = makeProvider();
    const code = await mintCode(provider);

    // Mint succeeds (201), but every DELETE fails (500) — simulates the API
    // being briefly unreachable at revoke time.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "DELETE") {
          return new Response("internal error", { status: 500 });
        }
        return new Response(JSON.stringify({ id: 99, token: "alm_abc" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const tokens = await provider.exchangeAuthorizationCode(client, code);
    await expect(
      provider.revokeToken(client, { token: tokens.access_token } as never),
    ).rejects.toThrow();

    // Retry, this time the DELETE succeeds — must still find the patId,
    // proving the failed attempt did not strand the token by deleting the
    // map entry despite the API call failing.
    const deleteCalls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        deleteCalls.push({ url: String(input), method });
        return new Response(null, { status: 204 });
      }),
    );
    await expect(
      provider.revokeToken(client, { token: tokens.access_token } as never),
    ).resolves.toBeUndefined();
    expect(deleteCalls).toContainEqual({
      url: "http://api.internal:3001/api/v1/auth/tokens/99",
      method: "DELETE",
    });
  });
});
