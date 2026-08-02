import { mintToken } from "@almanac/core/repos";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

/**
 * Tests for the user-facing auth surface:
 *   GET    /api/v1/auth/whoami           — identity probe
 *   GET    /api/v1/auth/tokens           — list active PATs for the caller
 *   POST   /api/v1/auth/tokens           — mint a new PAT (cleartext returned once)
 *   DELETE /api/v1/auth/tokens/:id       — revoke a PAT (idempotent, no-leak 204)
 *
 * Same fixture shape as packages/api/src/auth.test.ts: in-memory DB, single
 * seeded user (id=1) named Jeff. Tests that exercise multi-user scenarios
 * insert a second user inline.
 */
describe("auth routes", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  function setup(opts: { trustProxyHeaders?: boolean } = {}) {
    const a = buildApp({
      dbPath: ":memory:",
      trustProxyHeaders: opts.trustProxyHeaders ?? true,
    });
    a.db.prepare("INSERT INTO users (name, email) VALUES ('Jeff', 'jeff@example.com')").run();
    return a;
  }

  const headerAuth = { "x-forwarded-email": "jeff@example.com" };

  describe("GET /api/v1/auth/whoami", () => {
    it("returns the authenticated user when header path is used", async () => {
      app = setup();
      const r = await app.inject({
        method: "GET",
        url: "/api/v1/auth/whoami",
        headers: headerAuth,
      });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.id).toBe(1);
      expect(body.name).toBe("Jeff");
      expect(body.email).toBe("jeff@example.com");
      expect(body.preferred_unit_system).toBe("metric");
      expect(body.timezone).toBe("UTC");
      expect(body.llm_logging_enabled).toBe(0);
    });

    it("returns the authenticated user when token path is used", async () => {
      app = setup();
      const { token } = mintToken(app.db, { user_id: 1, name: "test-token" });
      const r = await app.inject({
        method: "GET",
        url: "/api/v1/auth/whoami",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().id).toBe(1);
    });

    it("returns 401 when no auth is presented", async () => {
      app = setup();
      const r = await app.inject({ method: "GET", url: "/api/v1/auth/whoami" });
      expect(r.statusCode).toBe(401);
      expect(r.json().error.code).toBe("unauthorized");
    });

    it("response includes email field (null when not set)", async () => {
      app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
      // Insert a user without an email — exercise the nullable branch.
      app.db.prepare("INSERT INTO users (name) VALUES ('Anon')").run();
      const { token } = mintToken(app.db, { user_id: 1, name: "t" });
      const r = await app.inject({
        method: "GET",
        url: "/api/v1/auth/whoami",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.id).toBe(1);
      expect(body.email).toBeNull();
    });
  });

  describe("POST /api/v1/auth/tokens", () => {
    it("mints a token, returns 201 with cleartext exactly once", async () => {
      app = setup();
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/auth/tokens",
        headers: { ...headerAuth, "content-type": "application/json" },
        payload: { name: "laptop" },
      });
      expect(r.statusCode).toBe(201);
      const body = r.json();
      expect(typeof body.token).toBe("string");
      expect(body.token).toMatch(/^alm_/);
      expect(body.name).toBe("laptop");
      expect(body.id).toEqual(expect.any(Number));

      // The list endpoint must NOT echo back the cleartext.
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/auth/tokens",
        headers: headerAuth,
      });
      expect(list.statusCode).toBe(200);
      const rows = list.json();
      expect(rows).toHaveLength(1);
      expect(rows[0]).not.toHaveProperty("token");
    });

    it("response includes prefix matching first 8 chars of cleartext", async () => {
      app = setup();
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/auth/tokens",
        headers: { ...headerAuth, "content-type": "application/json" },
        payload: { name: "laptop" },
      });
      expect(r.statusCode).toBe(201);
      const body = r.json();
      expect(body.prefix).toBe(body.token.slice(0, 8));
      expect(body.prefix).toHaveLength(8);
    });

    it("token can immediately authenticate subsequent requests", async () => {
      app = setup();
      const mint = await app.inject({
        method: "POST",
        url: "/api/v1/auth/tokens",
        headers: { ...headerAuth, "content-type": "application/json" },
        payload: { name: "cli" },
      });
      const { token } = mint.json();
      const me = await app.inject({
        method: "GET",
        url: "/api/v1/auth/whoami",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().id).toBe(1);
    });

    it("requires authenticated user (401 without auth headers)", async () => {
      app = setup();
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/auth/tokens",
        headers: { "content-type": "application/json" },
        payload: { name: "laptop" },
      });
      expect(r.statusCode).toBe(401);
      expect(r.json().error.code).toBe("unauthorized");
    });
  });

  describe("GET /api/v1/auth/tokens", () => {
    it("lists active tokens for the authenticated user", async () => {
      app = setup();
      mintToken(app.db, { user_id: 1, name: "alpha" });
      mintToken(app.db, { user_id: 1, name: "beta" });
      const r = await app.inject({
        method: "GET",
        url: "/api/v1/auth/tokens",
        headers: headerAuth,
      });
      expect(r.statusCode).toBe(200);
      const rows = r.json();
      expect(rows).toHaveLength(2);
      expect(rows.map((t: { name: string }) => t.name).sort()).toEqual(["alpha", "beta"]);
    });

    it("does NOT include cleartext token in list response", async () => {
      app = setup();
      mintToken(app.db, { user_id: 1, name: "alpha" });
      const r = await app.inject({
        method: "GET",
        url: "/api/v1/auth/tokens",
        headers: headerAuth,
      });
      expect(r.statusCode).toBe(200);
      const rows = r.json();
      expect(rows[0]).not.toHaveProperty("token");
      expect(rows[0]).not.toHaveProperty("token_hash");
    });

    it("does NOT include tokens from other users", async () => {
      app = setup();
      app.db.prepare("INSERT INTO users (name, email) VALUES ('Two', 'two@example.com')").run();
      mintToken(app.db, { user_id: 1, name: "mine" });
      mintToken(app.db, { user_id: 2, name: "theirs" });
      const r = await app.inject({
        method: "GET",
        url: "/api/v1/auth/tokens",
        headers: headerAuth,
      });
      expect(r.statusCode).toBe(200);
      const rows = r.json();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("mine");
    });

    it("excludes revoked tokens", async () => {
      app = setup();
      const a = mintToken(app.db, { user_id: 1, name: "alpha" });
      mintToken(app.db, { user_id: 1, name: "beta" });
      await app.inject({
        method: "DELETE",
        url: `/api/v1/auth/tokens/${a.record.id}`,
        headers: headerAuth,
      });
      const r = await app.inject({
        method: "GET",
        url: "/api/v1/auth/tokens",
        headers: headerAuth,
      });
      expect(r.statusCode).toBe(200);
      const rows = r.json();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("beta");
    });
  });

  describe("DELETE /api/v1/auth/tokens/:id", () => {
    it("revokes the token, returns 204", async () => {
      app = setup();
      const { record } = mintToken(app.db, { user_id: 1, name: "to-revoke" });
      const r = await app.inject({
        method: "DELETE",
        url: `/api/v1/auth/tokens/${record.id}`,
        headers: headerAuth,
      });
      expect(r.statusCode).toBe(204);
    });

    it("revoked token cannot authenticate subsequent requests", async () => {
      app = setup();
      const { token, record } = mintToken(app.db, { user_id: 1, name: "doomed" });
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/auth/tokens/${record.id}`,
        headers: headerAuth,
      });
      expect(del.statusCode).toBe(204);
      const me = await app.inject({
        method: "GET",
        url: "/api/v1/auth/whoami",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(401);
      expect(me.json().error.code).toBe("unauthorized");
    });

    it("idempotent — second revoke also returns 204", async () => {
      app = setup();
      const { record } = mintToken(app.db, { user_id: 1, name: "twice" });
      const first = await app.inject({
        method: "DELETE",
        url: `/api/v1/auth/tokens/${record.id}`,
        headers: headerAuth,
      });
      expect(first.statusCode).toBe(204);
      const second = await app.inject({
        method: "DELETE",
        url: `/api/v1/auth/tokens/${record.id}`,
        headers: headerAuth,
      });
      expect(second.statusCode).toBe(204);
    });

    it("returns 204 even when token belongs to a different user (no leak)", async () => {
      app = setup();
      app.db.prepare("INSERT INTO users (name, email) VALUES ('Two', 'two@example.com')").run();
      const other = mintToken(app.db, { user_id: 2, name: "theirs" });
      // Caller is user 1; tries to revoke a token whose id belongs to user 2.
      const r = await app.inject({
        method: "DELETE",
        url: `/api/v1/auth/tokens/${other.record.id}`,
        headers: headerAuth,
      });
      expect(r.statusCode).toBe(204);
    });

    it("does not actually revoke another user's token", async () => {
      app = setup();
      app.db.prepare("INSERT INTO users (name, email) VALUES ('Two', 'two@example.com')").run();
      const other = mintToken(app.db, { user_id: 2, name: "theirs" });

      // User 1 attempts to revoke user 2's token.
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/auth/tokens/${other.record.id}`,
        headers: headerAuth,
      });
      expect(del.statusCode).toBe(204);

      // User 2's token must still authenticate.
      const me = await app.inject({
        method: "GET",
        url: "/api/v1/auth/whoami",
        headers: { authorization: `Bearer ${other.token}` },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().id).toBe(2);
    });
  });
});
