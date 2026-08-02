/**
 * POC OAuth 2.1 provider for MCP — lets Claude mobile / ChatGPT connect
 * via the standard MCP OAuth discovery flow.
 *
 * Architecture:
 *   1. MCP client hits /mcp, gets 401 → discovers /.well-known/oauth-protected-resource
 *   2. Client does dynamic client registration → POST /register
 *   3. Client redirects user to /authorize → we redirect to Google sign-in
 *   4. Google redirects back to /oauth/google/callback → we extract email,
 *      check allowlist, mint an auth code
 *   5. Client exchanges auth code for access token → POST /token
 *   6. Client uses Bearer token on subsequent /mcp requests
 *
 * All state is in-memory (POC). Tokens survive until container restart.
 * PATs continue to work in parallel — verifyAccessToken falls back to the
 * API's PAT validation.
 */

import { randomBytes, randomUUID } from "node:crypto";
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
import type { Response } from "express";

// ─── Config ──────────────────────────────────────────────────────────

export type OAuthConfig = {
  /** Google OAuth client ID (same one oauth2-proxy uses). */
  googleClientId: string;
  /** Google OAuth client secret. */
  googleClientSecret: string;
  /**
   * Public base URL of the MCP server (e.g. https://almanac.example.com).
   * Used to construct the Google redirect URI and the issuer URL.
   */
  publicBaseUrl: string;
  /**
   * Allowed emails. If empty, any Google account is accepted.
   * In production this should be loaded from allowed-users.txt.
   */
  allowedEmails: Set<string>;
  /**
   * Internal API URL (e.g. http://almanac-api:3001). Used to mint PATs
   * via the API's POST /v1/auth/tokens endpoint using X-Forwarded-Email.
   */
  apiUrl: string;
};

// ─── In-memory stores ────────────────────────────────────────────────

type TokenData = {
  clientId: string;
  email: string;
  scopes: string[];
  expiresAt: number;
};

// Pending auth flows — keyed by the state we send to Google.
// Flow: authorize() stores the MCP client's params here, redirects to Google.
// Google callback looks up by state, verifies email, mints an auth code.
const pendingAuths = new Map<
  string,
  {
    clientId: string;
    params: AuthorizationParams;
  }
>();

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
   * Step 1: MCP client calls /authorize. We redirect to Google's consent
   * screen, stashing the MCP client's params so we can resume after the
   * Google callback.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const googleState = randomUUID();
    pendingAuths.set(googleState, {
      clientId: client.client_id,
      params,
    });

    // Build Google OAuth authorization URL
    const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleAuthUrl.searchParams.set("client_id", this.cfg.googleClientId);
    googleAuthUrl.searchParams.set(
      "redirect_uri",
      `${this.cfg.publicBaseUrl}/oauth/google/callback`,
    );
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "openid email");
    googleAuthUrl.searchParams.set("state", googleState);
    googleAuthUrl.searchParams.set("access_type", "online");
    googleAuthUrl.searchParams.set("prompt", "select_account");

    res.redirect(googleAuthUrl.toString());
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
    // pass the verified Google email to authenticate the request. The
    // returned cleartext token is a real PAT stored in the DB — the API
    // will accept it on subsequent MCP tool calls.
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

    const patResult = (await apiRes.json()) as { token: string };
    const token = patResult.token;

    // Track the token in-memory so verifyAccessToken can resolve it
    // without hitting the API on every request.
    accessTokens.set(token, {
      clientId: client.client_id,
      email: codeData.email,
      scopes: codeData.scopes,
      expiresAt: Date.now() + 365 * 24 * 3600 * 1000, // PATs don't expire
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

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    accessTokens.delete(request.token);
  }

  // ─── Google callback handler (mounted as a separate Express route) ──

  /**
   * Handles the Google OAuth callback. Not part of the OAuthServerProvider
   * interface — mounted directly on the Express app.
   *
   * Flow: Google redirects here with ?code=...&state=...
   * We exchange the Google code for a Google token, extract the email,
   * check the allowlist, then mint an MCP auth code and redirect back
   * to the MCP client's redirect_uri.
   */
  async handleGoogleCallback(
    query: { code?: string; state?: string; error?: string },
    res: Response,
  ): Promise<void> {
    if (query.error) {
      res.status(400).json({ error: `Google auth error: ${query.error}` });
      return;
    }

    const { code: googleCode, state: googleState } = query;
    if (!googleCode || !googleState) {
      res.status(400).json({ error: "Missing code or state from Google" });
      return;
    }

    // Look up the pending MCP auth request
    const pending = pendingAuths.get(googleState);
    if (!pending) {
      res.status(400).json({ error: "Unknown or expired state parameter" });
      return;
    }
    pendingAuths.delete(googleState);

    // Exchange Google's auth code for a token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: googleCode,
        client_id: this.cfg.googleClientId,
        client_secret: this.cfg.googleClientSecret,
        redirect_uri: `${this.cfg.publicBaseUrl}/oauth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("Google token exchange failed:", body);
      res.status(500).json({ error: "Google token exchange failed" });
      return;
    }

    const tokenBody = (await tokenRes.json()) as { id_token?: string; access_token?: string };

    // Extract email from the ID token (JWT, base64-decoded payload)
    let email: string | undefined;
    if (tokenBody.id_token) {
      try {
        const payloadSegment = tokenBody.id_token.split(".")[1];
        if (payloadSegment === undefined) {
          throw new Error("malformed id_token: missing payload segment");
        }
        const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString()) as {
          email?: string;
          email_verified?: boolean;
        };
        if (payload.email_verified) {
          email = payload.email;
        }
      } catch {
        // Fall through to userinfo
      }
    }

    // Fallback: fetch from Google's userinfo endpoint
    if (!email && tokenBody.access_token) {
      const userInfoRes = await fetch(
        `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${tokenBody.access_token}`,
      );
      if (userInfoRes.ok) {
        const userInfo = (await userInfoRes.json()) as { email?: string };
        email = userInfo.email;
      }
    }

    if (!email) {
      res.status(403).json({ error: "Could not determine email from Google" });
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
