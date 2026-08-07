/**
 * OAuth 2.1 provider for MCP — lets Claude mobile / ChatGPT connect via the
 * standard MCP OAuth discovery flow.
 *
 *   1. Client hits /mcp, gets 401 → discovers /.well-known/*
 *   2. Dynamic client registration → POST /register
 *   3. /authorize → we redirect to the upstream IdP
 *   4. IdP callback → verify id_token, check allowlist, mint an auth code
 *   5. POST /token → exchange the code for a PAT
 *
 * Issuer-generic: discovery, authorize-URL construction, code exchange, and
 * id_token verification all live in oidc.ts. OAuth state is in-memory and
 * does not survive a restart; the PATs it mints do.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Response as ExpressResponse } from "express";
import type { OidcClient } from "./oidc.js";

// ─── Config ──────────────────────────────────────────────────────────

export type OAuthConfig = {
  /**
   * Public base URL of the MCP server (e.g. https://almanac.example.com).
   * Combined with `callbackPath` to form the redirect URI used by both the
   * authorization request and the token exchange — these must be
   * byte-identical, per the OAuth spec.
   */
  publicBaseUrl: string;
  /**
   * Path (mounted on the Express app) that the upstream IdP redirects back
   * to after sign-in, e.g. "/oauth/callback".
   */
  callbackPath: string;
  /**
   * Allowed emails. If empty, any verified account from the upstream IdP
   * is accepted. In production this should be loaded from allowed-users.txt.
   */
  allowedEmails: Set<string>;
  /**
   * Internal API URL (e.g. http://almanac-api:3001). Used to mint PATs
   * via the API's POST /v1/auth/tokens endpoint using X-Forwarded-Email,
   * and to revoke them via DELETE /v1/auth/tokens/:id.
   */
  apiUrl: string;
  /** OIDC client for the upstream identity provider (see oidc.ts). */
  oidc: OidcClient;
};

// ─── In-memory stores ────────────────────────────────────────────────

type TokenData = {
  clientId: string;
  email: string;
  scopes: string[];
  expiresAt: number;
  /** The underlying PAT's DB id, used to revoke it via the API. Undefined
   *  only if the mint response was somehow missing it (should not happen). */
  patId: number | undefined;
};

// Pending auth flows — keyed by the state we send to the upstream IdP.
// Flow: authorize() stores the MCP client's params here, redirects upstream.
// The IdP callback looks up by state, verifies email, mints an auth code.
//
// Entries expire (see PENDING_AUTH_TTL_MS): a user who abandons sign-in at the
// IdP's consent screen never comes back to the callback, so the delete on the
// success path alone would leak an entry per abandoned flow. /authorize is
// reachable pre-SSO (compose sets --skip-auth-route=^/authorize), so without a
// TTL an unauthenticated client could grow this map without bound.
const pendingAuths = new Map<
  string,
  {
    clientId: string;
    params: AuthorizationParams;
    /**
     * PKCE verifier for the UPSTREAM leg (us ↔ the IdP) — freshly generated
     * per flow, never leaves this process until the token exchange. Distinct
     * from `params.codeChallenge`, which is the DOWNSTREAM leg's challenge
     * (MCP client ↔ us); we hold no verifier for that one, by design.
     */
    upstreamCodeVerifier: string;
    expiresAt: number;
  }
>();

// How long a user has to complete sign-in at the upstream IdP. Generous
// enough for a real login (password + MFA + consent), short enough that
// abandoned flows don't accumulate.
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

/** Drop every pending auth whose TTL has elapsed. Called on insert. */
function sweepExpiredPendingAuths(now: number): void {
  for (const [state, entry] of pendingAuths) {
    if (entry.expiresAt <= now) pendingAuths.delete(state);
  }
}

/**
 * Generate a fresh PKCE pair for the UPSTREAM leg (RFC 7636): a
 * high-entropy random verifier and its S256 challenge. 32 random bytes is
 * the RFC's recommended entropy; base64url keeps it inside the
 * unreserved-character alphabet the spec requires.
 */
function generateUpstreamPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// Auth codes — keyed by the code string. Short-lived (5 min).
const authCodes = new Map<
  string,
  {
    clientId: string;
    email: string;
    codeChallenge: string;
    redirectUri: string;
    scopes: string[];
    expiresAt: number;
  }
>();

// Access tokens — keyed by the token string.
const accessTokens = new Map<string, TokenData>();

// ─── Clients store ───────────────────────────────────────────────────

class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(
    metadata: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    const clientId = `almanac_${randomBytes(16).toString("hex")}`;
    const client: OAuthClientInformationFull = {
      ...metadata,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(clientId, client);
    return client;
  }
}

// ─── Provider ────────────────────────────────────────────────────────

export class AlmanacOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  private readonly cfg: OAuthConfig;

  constructor(cfg: OAuthConfig) {
    this.cfg = cfg;
    this.clientsStore = new InMemoryClientsStore();
  }

  /**
   * The redirect URI used for BOTH the authorization request and the token
   * exchange. OAuth requires these be byte-identical — this getter is the
   * single source of truth so the two call sites can never drift apart.
   */
  private get redirectUri(): string {
    return `${this.cfg.publicBaseUrl}${this.cfg.callbackPath}`;
  }

  /**
   * Redirect to the upstream IdP, stashing the MCP client's params to resume
   * on callback.
   *
   * Two independent PKCE legs — do not conflate them:
   *   DOWNSTREAM (client ↔ Almanac): the client owns the verifier; we only
   *     ever see `params.codeChallenge` and hand it back at /token.
   *   UPSTREAM (Almanac ↔ IdP): we are the client, so we mint our own pair.
   *
   * Sending the downstream challenge upstream leaves us unable to produce a
   * verifier at the IdP's token endpoint, which fails every login.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: ExpressResponse,
  ): Promise<void> {
    const upstreamState = randomUUID();
    const upstreamPkce = generateUpstreamPkcePair();

    sweepExpiredPendingAuths(Date.now());
    pendingAuths.set(upstreamState, {
      clientId: client.client_id,
      params,
      upstreamCodeVerifier: upstreamPkce.verifier,
      expiresAt: Date.now() + PENDING_AUTH_TTL_MS,
    });

    const authUrl = await this.cfg.oidc.authorizationUrl({
      redirectUri: this.redirectUri,
      state: upstreamState,
      // The UPSTREAM challenge — NOT params.codeChallenge (see above).
      codeChallenge: upstreamPkce.challenge,
    });

    res.redirect(authUrl.toString());
  }

  /**
   * Called by the SDK's token handler to retrieve the PKCE challenge
   * that was stored when the auth code was issued.
   */
  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const code = authCodes.get(authorizationCode);
    if (!code) throw new Error("Invalid authorization code");
    return code.codeChallenge;
  }

  /**
   * Step 3 (from the MCP client's perspective): exchange the auth code
   * for an access token.
   */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const codeData = authCodes.get(authorizationCode);
    if (!codeData) throw new Error("Invalid authorization code");
    if (codeData.clientId !== client.client_id) {
      throw new Error("Authorization code was not issued to this client");
    }
    if (codeData.expiresAt < Date.now()) {
      authCodes.delete(authorizationCode);
      throw new Error("Authorization code expired");
    }
    authCodes.delete(authorizationCode);

    // Mint a real PAT via the API. The API trusts X-Forwarded-Email from
    // within the Docker network (ALMANAC_TRUST_PROXY_HEADERS=true), so we
    // pass the verified email to authenticate the request. The returned
    // cleartext token is a real PAT stored in the DB — the API will accept
    // it on subsequent MCP tool calls.
    const clientName = `OAuth (${client.client_name ?? client.client_id.slice(0, 12)})`;
    const apiRes = await fetch(`${this.cfg.apiUrl}/api/v1/auth/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Email": codeData.email,
      },
      body: JSON.stringify({ name: clientName }),
    });

    if (!apiRes.ok) {
      const body = await apiRes.text();
      console.error(`Failed to mint PAT via API: ${apiRes.status} ${body}`);
      throw new Error("Failed to mint access token");
    }

    const patResult = (await apiRes.json()) as { id?: unknown; token: string };
    const token = patResult.token;
    const patId = typeof patResult.id === "number" ? patResult.id : undefined;

    // Track the token in-memory so verifyAccessToken can resolve it
    // without hitting the API on every request.
    accessTokens.set(token, {
      clientId: client.client_id,
      email: codeData.email,
      scopes: codeData.scopes,
      expiresAt: Date.now() + 365 * 24 * 3600 * 1000, // PATs don't expire
      patId,
    });

    return {
      access_token: token,
      token_type: "bearer",
      // PATs don't expire, but the OAuth spec requires a value.
      // Use a long duration so clients don't try to refresh.
      scope: codeData.scopes.join(" "),
    };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new Error("Refresh tokens not implemented in POC");
  }

  /**
   * Verify an access token. This is called on every /mcp request.
   * Checks the in-memory OAuth token map first.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // Check in-memory cache first.
    const data = accessTokens.get(token);
    if (data) {
      if (data.expiresAt < Date.now()) {
        accessTokens.delete(token);
        throw new Error("Token expired");
      }
      return {
        token,
        clientId: data.clientId,
        scopes: data.scopes,
        expiresAt: Math.floor(data.expiresAt / 1000),
        extra: { email: data.email },
      };
    }

    // Fall back to API validation — the token might be a PAT minted via
    // OAuth in a previous container lifetime (in-memory map was cleared
    // on restart, but the PAT is still in the DB).
    if (token.startsWith("alm_")) {
      const res = await fetch(`${this.cfg.apiUrl}/api/v1/auth/whoami`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const user = (await res.json()) as { email?: string };
        return {
          token,
          clientId: "pat",
          scopes: [],
          extra: { email: user.email },
        };
      }
    }

    throw new Error("Invalid or expired token");
  }

  /**
   * Revoke an access token: delete the PAT via the API, then clear the map
   * entry. Without the API call, verifyAccessToken's fallback re-accepts the
   * token on the next request.
   *
   * A map miss (e.g. after a restart) leaves no id to delete — log and
   * return. A failed DELETE throws and KEEPS the entry so a retry can still
   * resolve the id; the API's DELETE is idempotent.
   */
  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const data = accessTokens.get(request.token);
    if (data?.patId === undefined) {
      console.error(
        "revokeToken: no known PAT id for this token (map miss); clearing local state only",
      );
      accessTokens.delete(request.token);
      return;
    }

    let res: Response;
    try {
      res = await fetch(`${this.cfg.apiUrl}/api/v1/auth/tokens/${data.patId}`, {
        method: "DELETE",
        headers: { "X-Forwarded-Email": data.email },
      });
    } catch (cause) {
      throw new Error(`Failed to revoke PAT ${data.patId} via API: ${String(cause)}`);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to revoke PAT ${data.patId} via API: ${res.status} ${body}`);
    }

    accessTokens.delete(request.token);
  }

  // ─── Upstream IdP callback handler (mounted as a separate Express route) ──

  /**
   * Handles the upstream identity provider's OAuth callback. Not part of
   * the OAuthServerProvider interface — mounted directly on the Express app.
   *
   * Flow: the IdP redirects here with ?code=...&state=...
   * We exchange the code for tokens via the discovered token endpoint,
   * verify the id_token's signature against the IdP's JWKS, extract the
   * email, check the allowlist, then mint an MCP auth code and redirect
   * back to the MCP client's redirect_uri.
   */
  async handleCallback(
    query: { code?: string; state?: string; error?: string },
    res: ExpressResponse,
  ): Promise<void> {
    if (query.error) {
      res.status(400).json({ error: `Upstream auth error: ${query.error}` });
      return;
    }

    const { code: upstreamCode, state: upstreamState } = query;
    if (!upstreamCode || !upstreamState) {
      res.status(400).json({ error: "Missing code or state from upstream provider" });
      return;
    }

    // Look up the pending MCP auth request
    const pending = pendingAuths.get(upstreamState);
    if (!pending) {
      res.status(400).json({ error: "Unknown or expired state parameter" });
      return;
    }
    pendingAuths.delete(upstreamState);
    if (pending.expiresAt <= Date.now()) {
      res.status(400).json({ error: "Unknown or expired state parameter" });
      return;
    }

    let email: string;
    try {
      const tokenResponse = await this.cfg.oidc.exchangeCode({
        code: upstreamCode,
        redirectUri: this.redirectUri,
        // The UPSTREAM verifier stashed in authorize(); its S256 challenge
        // is what we sent to the IdP's authorize endpoint.
        codeVerifier: pending.upstreamCodeVerifier,
      });
      if (tokenResponse.idToken === undefined) {
        res.status(500).json({ error: "Upstream token response did not include an id_token" });
        return;
      }
      const verified = await this.cfg.oidc.verifyIdToken(tokenResponse.idToken, {
        accessToken: tokenResponse.accessToken,
      });
      email = verified.email;
    } catch (cause) {
      console.error("Upstream OIDC token exchange / verification failed:", cause);
      res.status(500).json({ error: "Upstream token exchange failed" });
      return;
    }

    // Check allowlist
    if (this.cfg.allowedEmails.size > 0 && !this.cfg.allowedEmails.has(email)) {
      res.status(403).json({ error: `Email ${email} is not in the allowed users list` });
      return;
    }

    // Mint an MCP authorization code
    const mcpCode = randomUUID();
    authCodes.set(mcpCode, {
      clientId: pending.clientId,
      email,
      codeChallenge: pending.params.codeChallenge,
      redirectUri: pending.params.redirectUri,
      scopes: pending.params.scopes ?? [],
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    // Redirect back to the MCP client's redirect_uri with the code
    const redirectUrl = new URL(pending.params.redirectUri);
    redirectUrl.searchParams.set("code", mcpCode);
    if (pending.params.state) {
      redirectUrl.searchParams.set("state", pending.params.state);
    }
    res.redirect(redirectUrl.toString());
  }
}
