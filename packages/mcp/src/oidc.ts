import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

export type OidcEndpoints = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  userinfoEndpoint: string | undefined;
};

/** Token-endpoint response, camelCased at the boundary. Deliberately
 *  wider than today's needs — refresh_token/expires_in flow through now
 *  so adding refresh later does not change this type. */
export type OidcTokenResponse = {
  idToken: string | undefined;
  accessToken: string | undefined;
  refreshToken: string | undefined;
  expiresIn: number | undefined;
  tokenType: string | undefined;
  scope: string | undefined;
};

export type OidcClient = {
  endpoints(): Promise<OidcEndpoints>;
  /** Build the upstream authorize URL. Owns scope + PKCE params. */
  authorizationUrl(opts: {
    redirectUri: string;
    state: string;
    codeChallenge?: string;
  }): Promise<URL>;
  /** Exchange an authorization code at the discovered token endpoint. */
  exchangeCode(opts: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<OidcTokenResponse>;
  /**
   * Verify an ID token's signature and claims, and resolve the user's email.
   *
   * `opts.accessToken` enables the userinfo fallback for issuers that omit
   * `email` from the ID token (permitted by OIDC Core — `email` is only
   * returned in the ID token at the issuer's discretion). Without it, such an
   * issuer cannot authenticate at all.
   */
  verifyIdToken(
    idToken: string,
    opts?: { accessToken?: string },
  ): Promise<{ email: string; sub: string }>;
};

const DEFAULT_SCOPE = "openid email";

// Asymmetric algorithms only. HS* must never appear here — a forged token could
// be signed with a public key from the JWKS treated as an HMAC secret ("alg
// confusion"). Keycloak advertises HS256, so we enforce this rather than trust
// the discovery document.
export const ASYMMETRIC_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
] as const;

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

type DiscoveryDocument = {
  issuer: unknown;
  authorization_endpoint: unknown;
  token_endpoint: unknown;
  jwks_uri: unknown;
  userinfo_endpoint: unknown;
};

type TokenEndpointResponse = {
  id_token: unknown;
  access_token: unknown;
  refresh_token: unknown;
  expires_in: unknown;
  token_type: unknown;
  scope: unknown;
};

/**
 * Shape-check an issuer URL at boot — absolute http(s), no query or fragment. No
 * network call. Strips a trailing slash so discovery URLs don't double up.
 */
export function validateIssuerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid OIDC issuer URL (must be absolute): ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid OIDC issuer URL (must be absolute http/https): ${raw}`);
  }
  if (url.search !== "") {
    throw new Error(`Invalid OIDC issuer URL (must not carry a query string): ${raw}`);
  }
  if (url.hash !== "") {
    throw new Error(`Invalid OIDC issuer URL (must not carry a fragment): ${raw}`);
  }
  return url.href.endsWith("/") ? url.href.slice(0, -1) : url.href;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const MAX_ERROR_BODY_CHARS = 500;

/** Truncate an upstream error body and redact the client secret — gateways
 *  sometimes echo request params back. */
function sanitizeErrorBody(body: string, clientSecret: string | undefined): string {
  const truncated =
    body.length > MAX_ERROR_BODY_CHARS
      ? `${body.slice(0, MAX_ERROR_BODY_CHARS)}...[truncated]`
      : body;
  return clientSecret !== undefined && clientSecret.length > 0
    ? truncated.replaceAll(clientSecret, "[redacted]")
    : truncated;
}

function parseDiscoveryDocument(issuer: string, body: unknown): OidcEndpoints {
  if (typeof body !== "object" || body === null) {
    throw new Error("OIDC discovery document was not a JSON object");
  }
  const doc = body as Partial<DiscoveryDocument>;

  if (doc.issuer !== issuer) {
    throw new Error(
      `OIDC discovery issuer mismatch: configured issuer is "${issuer}" but the ` +
        `discovery document reported "${String(doc.issuer)}"`,
    );
  }
  if (!isNonEmptyString(doc.authorization_endpoint)) {
    throw new Error("OIDC discovery document missing authorization_endpoint");
  }
  if (!isNonEmptyString(doc.token_endpoint)) {
    throw new Error("OIDC discovery document missing token_endpoint");
  }
  if (!isNonEmptyString(doc.jwks_uri)) {
    throw new Error("OIDC discovery document missing jwks_uri");
  }

  return {
    issuer,
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    jwksUri: doc.jwks_uri,
    userinfoEndpoint: isNonEmptyString(doc.userinfo_endpoint) ? doc.userinfo_endpoint : undefined,
  };
}

function parseTokenResponse(body: unknown): OidcTokenResponse {
  const doc = (
    typeof body === "object" && body !== null ? body : {}
  ) as Partial<TokenEndpointResponse>;
  return {
    idToken: isNonEmptyString(doc.id_token) ? doc.id_token : undefined,
    accessToken: isNonEmptyString(doc.access_token) ? doc.access_token : undefined,
    refreshToken: isNonEmptyString(doc.refresh_token) ? doc.refresh_token : undefined,
    expiresIn: typeof doc.expires_in === "number" ? doc.expires_in : undefined,
    tokenType: isNonEmptyString(doc.token_type) ? doc.token_type : undefined,
    scope: isNonEmptyString(doc.scope) ? doc.scope : undefined,
  };
}

export function createOidcClient(opts: {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  /** Defaults to "openid email". */
  scope?: string;
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
}): OidcClient {
  const issuer = validateIssuerUrl(opts.issuer);
  const { clientId, clientSecret, fetchImpl } = opts;
  const scope = opts.scope ?? DEFAULT_SCOPE;
  const cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  let cached: { endpoints: OidcEndpoints; expiresAt: number } | undefined;
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  let jwksUriForCurrentJwks: string | undefined;

  async function doFetch(url: string, init?: RequestInit): Promise<Response> {
    return fetchImpl ? fetchImpl(url, init) : fetch(url, init);
  }

  async function endpoints(): Promise<OidcEndpoints> {
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return cached.endpoints;
    }

    const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
    let response: Response;
    try {
      response = await doFetch(discoveryUrl);
    } catch (cause) {
      throw new Error(`OIDC discovery request failed for ${discoveryUrl}: ${String(cause)}`);
    }
    if (!response.ok) {
      throw new Error(`OIDC discovery request failed for ${discoveryUrl}: HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new Error(
        `OIDC discovery response from ${discoveryUrl} was not valid JSON: ${String(cause)}`,
      );
    }

    const resolved = parseDiscoveryDocument(issuer, body);
    cached = { endpoints: resolved, expiresAt: Date.now() + cacheTtlMs };
    return resolved;
  }

  async function authorizationUrl(authOpts: {
    redirectUri: string;
    state: string;
    codeChallenge?: string;
  }): Promise<URL> {
    const ep = await endpoints();
    const url = new URL(ep.authorizationEndpoint);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", authOpts.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", authOpts.state);
    if (authOpts.codeChallenge !== undefined) {
      url.searchParams.set("code_challenge", authOpts.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url;
  }

  async function exchangeCode(exchangeOpts: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<OidcTokenResponse> {
    const ep = await endpoints();
    const params = new URLSearchParams();
    params.set("grant_type", "authorization_code");
    params.set("code", exchangeOpts.code);
    params.set("redirect_uri", exchangeOpts.redirectUri);
    params.set("client_id", clientId);
    if (clientSecret !== undefined) {
      params.set("client_secret", clientSecret);
    }
    if (exchangeOpts.codeVerifier !== undefined) {
      params.set("code_verifier", exchangeOpts.codeVerifier);
    }

    const response = await doFetch(ep.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = sanitizeErrorBody(await response.text(), clientSecret);
      throw new Error(
        `OIDC token exchange failed at ${ep.tokenEndpoint}: HTTP ${response.status} ${errorBody}`,
      );
    }

    const body = await response.json();
    return parseTokenResponse(body);
  }

  function getJwks(jwksUri: string) {
    if (jwks === undefined || jwksUriForCurrentJwks !== jwksUri) {
      jwks = createRemoteJWKSet(new URL(jwksUri), {
        ...(fetchImpl ? { [customFetch]: fetchImpl } : {}),
      });
      jwksUriForCurrentJwks = jwksUri;
    }
    return jwks;
  }

  /**
   * Email fallback for issuers that omit it from the ID token. The `sub` match
   * is required, not an optimization: the userinfo body is unsigned, so the
   * matching subject is its only binding to the identity we just verified.
   */
  async function fetchEmailFromUserinfo(
    userinfoEndpoint: string,
    accessToken: string,
    verifiedSub: string,
  ): Promise<string> {
    let response: Response;
    try {
      response = await doFetch(userinfoEndpoint, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
    } catch (cause) {
      throw new Error(`OIDC userinfo request failed at ${userinfoEndpoint}: ${String(cause)}`);
    }
    if (!response.ok) {
      throw new Error(
        `OIDC userinfo request failed at ${userinfoEndpoint}: HTTP ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new Error(`OIDC userinfo response was not valid JSON: ${String(cause)}`);
    }
    if (typeof body !== "object" || body === null) {
      throw new Error("OIDC userinfo response was not a JSON object");
    }
    const claims = body as { sub?: unknown; email?: unknown; email_verified?: unknown };

    if (!isNonEmptyString(claims.sub) || claims.sub !== verifiedSub) {
      throw new Error("OIDC userinfo rejected: sub does not match the verified id_token's sub");
    }
    if (claims.email_verified !== true) {
      throw new Error("OIDC userinfo rejected: email_verified is not true");
    }
    if (!isNonEmptyString(claims.email)) {
      throw new Error("OIDC userinfo rejected: missing or empty email claim");
    }
    return claims.email;
  }

  async function verifyIdToken(
    idToken: string,
    verifyOpts?: { accessToken?: string },
  ): Promise<{ email: string; sub: string }> {
    const ep = await endpoints();
    const jwksForIssuer = getJwks(ep.jwksUri);

    const { payload } = await jwtVerify(idToken, jwksForIssuer, {
      issuer: ep.issuer,
      audience: clientId,
      algorithms: [...ASYMMETRIC_ALGORITHMS],
    });

    const { sub } = payload;
    if (!isNonEmptyString(sub)) {
      throw new Error("id_token rejected: missing or empty sub claim");
    }

    // Happy path: the ID token itself carries a verified email.
    const { email } = payload;
    if (isNonEmptyString(email)) {
      if (payload.email_verified !== true) {
        throw new Error("id_token rejected: email_verified is not true");
      }
      return { email, sub };
    }

    // Issuer omits `email` from the ID token (allowed by OIDC Core).
    const { userinfoEndpoint } = ep;
    const accessToken = verifyOpts?.accessToken;
    if (userinfoEndpoint === undefined || !isNonEmptyString(accessToken)) {
      throw new Error("id_token rejected: missing or empty email claim");
    }

    return { email: await fetchEmailFromUserinfo(userinfoEndpoint, accessToken, sub), sub };
  }

  return { endpoints, authorizationUrl, exchangeCode, verifyIdToken };
}
