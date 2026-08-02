import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { ApiClient } from "./client.js";
import { loadConfig } from "./config.js";
import { AlmanacOAuthProvider } from "./oauth-provider.js";
import { buildMcpServer } from "./server.js";

const cfg = loadConfig();
const api = new ApiClient({ baseUrl: cfg.ALMANAC_API_URL });
const mcpDeps = { api };

if (cfg.ALMANAC_MCP_TRANSPORT === "stdio") {
  // stdio: parent process is the trust boundary. No HTTP, no auth.
  // CRITICAL: anything written to stdout (console.log) corrupts the protocol
  // stream. Logs MUST go to stderr.
  //
  // The bearer threaded through to the API is captured from
  // ALMANAC_MCP_CLIENT_TOKEN at process start. In local dev this is a PAT
  // minted off the operator's user; in v1 stdio there's only one identity
  // per process lifetime.
  const token = cfg.ALMANAC_MCP_CLIENT_TOKEN ?? "";
  if (!token) {
    console.error("WARNING: ALMANAC_MCP_CLIENT_TOKEN is empty; API calls will fail with 401.");
  }
  const server = buildMcpServer(mcpDeps, () => token);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("almanac-mcp connected via stdio");
} else if (cfg.ALMANAC_MCP_TRANSPORT === "sse") {
  // sse: HTTP listener. Deprecated per the 2025-03-26 MCP spec rev — kept
  // here for backward compat with existing .env files. Operators should
  // migrate to ALMANAC_MCP_TRANSPORT=http (Streamable HTTP). The SSE branch
  // is slated for removal in a later cleanup pass.
  console.error(
    "WARNING: ALMANAC_MCP_TRANSPORT=sse is deprecated. Set ALMANAC_MCP_TRANSPORT=http to use Streamable HTTP.",
  );
  // SSE is a two-endpoint dance: client opens GET /sse to receive server→client
  // events, and POSTs JSON-RPC requests to /messages?sessionId=<id>. We track
  // live transports by sessionId so POSTs can be routed to the right stream.
  // Each connection gets its OWN Server instance — Server.connect() stores the
  // transport in a singleton field, so a shared Server would route replies to
  // whichever connection most recently called connect(), even for requests
  // that arrived on an older connection. mcp-remote reconnects routinely.
  const transports = new Map<string, SSEServerTransport>();
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/sse") {
      // Per-connection bearer capture: extract Authorization header from the
      // incoming HTTP request, close over it for the connection lifetime, and
      // thread to API calls via `currentToken`. No static gate-check — the
      // API validates each PAT against `personal_access_tokens` table. The
      // sanity check below rejects requests with no Authorization header at
      // all, since a session without a bearer will 401 on every tool call.
      const authz = req.headers.authorization ?? "";
      if (!authz.startsWith("Bearer ")) {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "Missing Authorization: Bearer <token>" }));
        return;
      }
      const bearer = authz.slice(7);

      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      res.on("close", () => transports.delete(transport.sessionId));
      const perConnectionServer = buildMcpServer(mcpDeps, () => bearer);
      await perConnectionServer.connect(transport);
      return;
    }
    if (req.method === "POST" && url.pathname === "/messages") {
      const sessionId = url.searchParams.get("sessionId");
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        res.statusCode = 404;
        res.end("unknown session");
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  httpServer.listen(cfg.ALMANAC_MCP_PORT, cfg.ALMANAC_MCP_HOST, () => {
    console.error(`almanac-mcp listening on ${cfg.ALMANAC_MCP_HOST}:${cfg.ALMANAC_MCP_PORT} (sse)`);
  });
  // Graceful shutdown for Docker `restart: unless-stopped` — SIGTERM gives us
  // ~10s before SIGKILL; close the HTTP server so in-flight SSE streams flush.
  // The stdio branch doesn't need this — stdin closure handles parent death.
  process.on("SIGTERM", () => {
    httpServer.close(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    httpServer.close(() => process.exit(0));
  });
} else {
  // Streamable HTTP with optional OAuth 2.1.
  //
  // When ALMANAC_MCP_OAUTH_CLIENT_ID is set, the server mounts the SDK's
  // mcpAuthRouter which serves the .well-known discovery endpoints,
  // /authorize, /token, and /register — letting Claude mobile and ChatGPT
  // connect via the standard MCP OAuth flow. Google is the upstream IdP.
  //
  // When the OAuth vars are NOT set, the server falls back to the previous
  // behavior: raw Bearer token (PAT) validation only.
  //
  // In both modes, PATs continue to work — the /mcp handler accepts any
  // Bearer token and threads it to the API for validation.

  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Load allowed emails for the OAuth allowlist.
  function loadAllowedEmails(): Set<string> {
    const raw = cfg.ALMANAC_ALLOWED_EMAILS ?? cfg.ALMANAC_MCP_ALLOWED_EMAILS ?? "";
    if (!raw) return new Set();
    // If it looks like a file path, read it
    if (raw.startsWith("/") || raw.startsWith("./")) {
      try {
        const content = readFileSync(raw, "utf-8");
        return new Set(
          content
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#")),
        );
      } catch (err) {
        console.error(`WARNING: Could not read allowed-emails file ${raw}:`, err);
        return new Set();
      }
    }
    // Otherwise treat as comma-separated list
    return new Set(
      raw
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean),
    );
  }

  // Bind the three OAuth env vars to consts and gate on explicit
  // `!== undefined` checks so control-flow analysis narrows each to `string`
  // inside the `if (oauthEnabled)` block — no non-null assertions needed.
  const oauthClientId = cfg.ALMANAC_MCP_OAUTH_CLIENT_ID;
  const oauthClientSecret = cfg.ALMANAC_MCP_OAUTH_CLIENT_SECRET;
  const oauthPublicUrl = cfg.ALMANAC_MCP_PUBLIC_URL;
  const oauthEnabled =
    oauthClientId !== undefined && oauthClientSecret !== undefined && oauthPublicUrl !== undefined;

  // Handler for /mcp requests — shared between OAuth and non-OAuth modes.
  // The bearer is captured from the Authorization header (either a PAT or
  // an OAuth-issued token) and threaded to the API.
  async function handleMcpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    bearerOverride?: string,
  ) {
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId === "string") {
      const existing = transports.get(sessionId);
      if (existing) {
        await existing.handleRequest(req, res);
        return;
      }
      // Session ID not recognized (e.g. server restarted, in-memory map
      // wiped). Return 404 per the Streamable HTTP spec — this signals the
      // client to discard the stale session and re-initialize.
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    // Determine the bearer token. OAuth-mode passes it via bearerOverride
    // (already verified by the auth middleware). PAT-mode extracts it from
    // the Authorization header directly.
    const bearer =
      bearerOverride ??
      (() => {
        const authz = req.headers.authorization ?? "";
        if (!authz.startsWith("Bearer ")) return null;
        return authz.slice(7);
      })();

    if (!bearer) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Missing Authorization: Bearer <token>" }));
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport);
      },
    });

    const perConnectionServer = buildMcpServer(mcpDeps, () => bearer);
    await perConnectionServer.connect(transport);

    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };

    await transport.handleRequest(req, res);
  }

  if (oauthEnabled) {
    // ─── OAuth 2.1 mode ───────────────────────────────────────────
    const publicUrl = oauthPublicUrl;
    const allowedEmails = loadAllowedEmails();

    const oauthProvider = new AlmanacOAuthProvider({
      googleClientId: oauthClientId,
      googleClientSecret: oauthClientSecret,
      publicBaseUrl: publicUrl,
      allowedEmails,
      apiUrl: cfg.ALMANAC_API_URL,
    });

    const app = express();

    // The SDK's auth router must be mounted at / — it serves
    // /.well-known/*, /authorize, /token, /register.
    app.use(
      mcpAuthRouter({
        provider: oauthProvider,
        issuerUrl: new URL(publicUrl),
        baseUrl: new URL(publicUrl),
        resourceServerUrl: new URL("/mcp", publicUrl),
        resourceName: "Almanac MCP",
        scopesSupported: ["mcp:tools"],
      }),
    );

    // Google OAuth callback — outside the SDK's router.
    app.get("/oauth/google/callback", async (req, res) => {
      await oauthProvider.handleGoogleCallback(
        req.query as { code?: string; state?: string; error?: string },
        res,
      );
    });

    // /mcp — the actual MCP endpoint. The SDK's bearerAuth middleware
    // runs before this via the auth router's RequiredBearerAuth, but
    // since we're handling /mcp ourselves (not via the auth router),
    // we manually extract and validate the token.
    app.all("/mcp", async (req, res) => {
      const authz = req.headers.authorization ?? "";
      if (!authz.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing Authorization: Bearer <token>" });
        return;
      }
      const token = authz.slice(7);

      // Try OAuth token first, fall back to treating it as a PAT.
      // OAuth tokens are verified in-memory; PATs are passed through
      // to the API which validates them against the DB.
      let bearer = token;
      try {
        const authInfo = await oauthProvider.verifyAccessToken(token);
        // OAuth token verified. The email is in authInfo.extra.email.
        // For the POC, we pass the OAuth token itself as the bearer —
        // the API will need to also accept OAuth tokens, OR we could
        // mint a PAT on the fly. For now, we use X-Forwarded-Email
        // via a direct API call to resolve the user.
        // TODO: In production, auto-mint a PAT on first OAuth login
        // and cache the mapping.
        bearer = token;
        console.error(`OAuth token verified for ${(authInfo.extra as { email?: string })?.email}`);
      } catch {
        // Not an OAuth token — assume it's a PAT, pass through.
      }

      await handleMcpRequest(req, res, bearer);
    });

    const httpServer = app.listen(cfg.ALMANAC_MCP_PORT, cfg.ALMANAC_MCP_HOST, () => {
      console.error(
        `almanac-mcp listening on ${cfg.ALMANAC_MCP_HOST}:${cfg.ALMANAC_MCP_PORT} (http, Streamable HTTP + OAuth 2.1)`,
      );
      console.error(`  OAuth issuer: ${publicUrl}`);
      console.error(`  Google callback: ${publicUrl}/oauth/google/callback`);
    });

    process.on("SIGTERM", () => {
      httpServer.close(() => process.exit(0));
    });
    process.on("SIGINT", () => {
      httpServer.close(() => process.exit(0));
    });
  } else {
    // ─── PAT-only mode (no OAuth) ─────────────────────────────────
    // Original behavior: raw http.createServer, Bearer PAT only.
    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/mcp") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      await handleMcpRequest(req, res);
    });

    httpServer.listen(cfg.ALMANAC_MCP_PORT, cfg.ALMANAC_MCP_HOST, () => {
      console.error(
        `almanac-mcp listening on ${cfg.ALMANAC_MCP_HOST}:${cfg.ALMANAC_MCP_PORT} (http, Streamable HTTP, PAT-only)`,
      );
    });

    process.on("SIGTERM", () => {
      httpServer.close(() => process.exit(0));
    });
    process.on("SIGINT", () => {
      httpServer.close(() => process.exit(0));
    });
  }
}
