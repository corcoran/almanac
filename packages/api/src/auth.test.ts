import { mintToken, revokeToken } from "@almanac/core/repos";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./server.js";

describe("authPreHandler", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  /**
   * Build a fresh in-memory app with a single seed user (id=1) named Jeff.
   * Email is left null unless a test sets it — exercises both lookup paths.
   */
  function setup(opts: { trustProxyHeaders?: boolean; allowedEmails?: Set<string> } = {}) {
    const a = buildApp({
      dbPath: ":memory:",
      trustProxyHeaders: opts.trustProxyHeaders ?? true,
      allowedEmails: opts.allowedEmails,
    });
    a.db.prepare("INSERT INTO users (name) VALUES ('Jeff')").run();
    return a;
  }

  it("PUBLIC_PATHS bypass auth: /api/v1/health", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(r.statusCode).toBe(200);
  });

  it("PUBLIC_PATHS bypass auth: /api/v1/version", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/version" });
    expect(r.statusCode).toBe(200);
  });

  it("token path: valid token resolves req.userId", async () => {
    app = setup();
    const { token } = mintToken(app.db, { user_id: 1, name: "test-token" });
    // /api/v1/users/me reads req.userId via getCurrentUserId -> after the sweep,
    // req.userId set by the preHandler. Either way: status 200 proves auth
    // succeeded and a userId was attached.
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(1);
  });

  it("token path: revoked token → 401", async () => {
    app = setup();
    const { token, record } = mintToken(app.db, { user_id: 1, name: "test-token" });
    expect(revokeToken(app.db, record.id, 1)).toBe(true);
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("unauthorized");
  });

  it("token path: unknown token → 401", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { authorization: "Bearer alm_doesnotexist" },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("unauthorized");
  });

  it("header path: X-Forwarded-Email resolves req.userId", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET email = 'jeff@example.com' WHERE id = 1").run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { "x-forwarded-email": "jeff@example.com" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(1);
  });

  it("header path: missing email + missing token → 401", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/users/me" });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("unauthorized");
  });

  it("header path: existing user matched by email", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET email = 'jeff@example.com' WHERE id = 1").run();
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { "x-forwarded-email": "jeff@example.com" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(1);
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    expect(after.c).toBe(before.c); // no auto-provision when match exists
  });

  it("header path: unknown email auto-provisions when no allowlist set", async () => {
    app = setup();
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { "x-forwarded-email": "newcomer@example.com" },
    });
    expect(r.statusCode).toBe(200);
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    expect(after.c).toBe(before.c + 1);
    expect(r.json().id).toBe(2);
    expect(r.json().name).toBe("newcomer");
  });

  it("auto-provisions the FIRST user (empty table) as an admin", async () => {
    // Fresh app with NO seeded user — the first person to sign in owns the
    // instance and is bootstrapped as admin so a new deployment isn't locked
    // out of the admin tooling.
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    try {
      const r = await a.inject({
        method: "GET",
        url: "/api/v1/users/me",
        headers: { "x-forwarded-email": "owner@example.com" },
      });
      expect(r.statusCode).toBe(200);
      const row = a.db
        .prepare("SELECT is_admin FROM users WHERE email = ?")
        .get("owner@example.com") as { is_admin: number } | undefined;
      expect(row?.is_admin).toBe(1);
    } finally {
      await a.close();
    }
  });

  it("does NOT make a later auto-provisioned user an admin", async () => {
    // setup() seeds user id 1 (Jeff). A subsequent auto-provision is a non-admin.
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { "x-forwarded-email": "second@example.com" },
    });
    expect(r.statusCode).toBe(200);
    const row = app.db
      .prepare("SELECT is_admin FROM users WHERE email = ?")
      .get("second@example.com") as { is_admin: number } | undefined;
    expect(row?.is_admin).toBe(0);
  });

  it("header path: unknown email blocked when not in allowlist", async () => {
    app = setup({ allowedEmails: new Set(["jeff@example.com"]) });
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { "x-forwarded-email": "stranger@example.com" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("forbidden");
    const after = app.db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    expect(after.c).toBe(before.c);
  });

  it("header path: allowed email auto-provisions when in allowlist", async () => {
    app = setup({ allowedEmails: new Set(["newcomer@example.com"]) });
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { "x-forwarded-email": "newcomer@example.com" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().name).toBe("newcomer");
  });

  it("header path: existing user bypasses allowlist check", async () => {
    app = setup({ allowedEmails: new Set(["someone-else@example.com"]) });
    app.db.prepare("UPDATE users SET email = 'jeff@example.com' WHERE id = 1").run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { "x-forwarded-email": "jeff@example.com" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(1);
  });

  it("token path beats header path when both present (token wins, no surprise)", async () => {
    app = setup();
    // Seed a second user; mint a token for THAT user.
    app.db.prepare("INSERT INTO users (name, email) VALUES ('Two', 'two@example.com')").run();
    app.db.prepare("UPDATE users SET email = 'one@example.com' WHERE id = 1").run();
    const { token } = mintToken(app.db, { user_id: 2, name: "u2-token" });
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: {
        authorization: `Bearer ${token}`,
        "x-forwarded-email": "one@example.com",
      },
    });
    expect(r.statusCode).toBe(200);
    // Token path wins → user id=2.
    expect(r.json().id).toBe(2);
  });

  it("header path is rejected when ALMANAC_TRUST_PROXY_HEADERS is not 'true'", async () => {
    app = setup({ trustProxyHeaders: false });
    app.db.prepare("UPDATE users SET email = 'jeff@example.com' WHERE id = 1").run();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { "x-forwarded-email": "jeff@example.com" },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("unauthorized");
  });
});
