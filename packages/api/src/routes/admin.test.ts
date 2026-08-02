import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

/**
 * Tests for the admin-only user-management surface:
 *   GET   /api/v1/admin/users        — list every user (admin only)
 *   PATCH /api/v1/admin/users/:id     — mutate a target's flags/limit (admin only)
 *
 * Same fixture shape as auth.test.ts: in-memory DB, header-trust auth. Seeds an
 * admin (id 1, is_admin = 1) and a normal user (id 2, is_admin defaults to 0).
 */
describe("admin routes", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  function setup() {
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    a.db
      .prepare("INSERT INTO users (name, email, is_admin) VALUES ('Admin', 'admin@x.com', 1)")
      .run(); // id 1
    a.db.prepare("INSERT INTO users (name, email) VALUES ('Sam', 'sam@x.com')").run(); // id 2, is_admin 0
    return a;
  }
  const asAdmin = { "x-forwarded-email": "admin@x.com" };
  const asUser = { "x-forwarded-email": "sam@x.com" };

  it("GET /api/v1/admin/users returns the list for an admin", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/admin/users", headers: asAdmin });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    const sam = body.find((u: { id: number }) => u.id === 2);
    expect(sam.is_admin).toBe(0);
    expect(sam.llm_daily_token_limit).toBeNull();
  });

  it("GET /api/v1/admin/users 403s for a non-admin", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/admin/users", headers: asUser });
    expect(r.statusCode).toBe(403);
  });

  it("PATCH /api/v1/admin/users/:id sets a target's daily limit", async () => {
    app = setup();
    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/users/2",
      headers: asAdmin,
      payload: { llm_daily_token_limit: 30000 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().llm_daily_token_limit).toBe(30000);
    // confirm it persisted
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/users", headers: asAdmin });
    expect(list.json().find((u: { id: number }) => u.id === 2).llm_daily_token_limit).toBe(30000);
  });

  it("PATCH /api/v1/admin/users/:id can clear the limit (null)", async () => {
    app = setup();
    await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/users/2",
      headers: asAdmin,
      payload: { llm_daily_token_limit: 30000 },
    });
    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/users/2",
      headers: asAdmin,
      payload: { llm_daily_token_limit: null },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().llm_daily_token_limit).toBeNull();
  });

  it("PATCH /api/v1/admin/users/:id can toggle llm_logging_enabled and is_admin", async () => {
    app = setup();
    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/users/2",
      headers: asAdmin,
      payload: { llm_logging_enabled: 1, is_admin: 1 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().llm_logging_enabled).toBe(1);
    expect(r.json().is_admin).toBe(1);
  });

  it("PATCH /api/v1/admin/users/:id 403s for a non-admin and does not change the target", async () => {
    app = setup();
    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/users/1",
      headers: asUser,
      payload: { is_admin: 0 },
    });
    expect(r.statusCode).toBe(403);
    // admin (id 1) is unchanged
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/users", headers: asAdmin });
    expect(list.json().find((u: { id: number }) => u.id === 1).is_admin).toBe(1);
  });

  it("PATCH /api/v1/admin/users/:id 404s for an unknown target", async () => {
    app = setup();
    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/users/9999",
      headers: asAdmin,
      payload: { llm_daily_token_limit: 1000 },
    });
    expect(r.statusCode).toBe(404);
  });

  it("PATCH /api/v1/admin/users/:id 422s on an unknown body field (strict schema)", async () => {
    app = setup();
    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/users/2",
      headers: asAdmin,
      payload: { name: "hacker" },
    });
    expect(r.statusCode).toBe(422);
  });
});
