import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/users", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  function setup() {
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    a.db
      .prepare(
        "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('Jeff', '1990-01-01', 180, 'male', 'test@example.com')",
      )
      .run();
    return a;
  }
  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  it("GET /api/v1/users/me returns the current user", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: auth });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.id).toBe(1);
    expect(body.name).toBe("Jeff");
    expect(body.height_cm).toBe(180);
    expect(body.sex).toBe("male");
  });

  it("GET /api/v1/users/me returns 401 when no auth headers are present", async () => {
    app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    // Note: with the new auth shape, a request with X-Forwarded-Email
    // auto-provisions a user — so to assert 401, the request must carry
    // neither a Bearer token NOR a forwarded email. The legacy
    // "no users exist" wording no longer applies; the equivalent is
    // "no credentials presented".
    const r = await app.inject({ method: "GET", url: "/api/v1/users/me" });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("unauthorized");
  });

  it("PATCH /api/v1/users/me updates fields", async () => {
    app = setup();
    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/users/me",
      headers: auth,
      payload: { name: "Jeffrey", height_cm: 182 },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.name).toBe("Jeffrey");
    expect(body.height_cm).toBe(182);
    expect(body.sex).toBe("male"); // untouched
  });

  it("PATCH /api/v1/users/me persists activity_level and reads it back", async () => {
    app = setup();
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/users/me",
      headers: auth,
      payload: { activity_level: "active" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().activity_level).toBe("active");

    const get = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: auth });
    expect(get.json().activity_level).toBe("active");
  });

  it("PATCH /api/v1/users/me 422 on unknown field", async () => {
    app = setup();
    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/users/me",
      headers: auth,
      payload: { totally_made_up: "no" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("validation_failed");
  });

  it("401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/users/me" });
    expect(r.statusCode).toBe(401);
  });

  it("POST /api/v1/users no longer exists — auth-layer provisioning is the only path", async () => {
    // The bootstrap route was removed: it inserted an EMAIL-LESS users row,
    // so signing in afterwards provisioned a SECOND account and stranded the
    // first one's data (admin included). Account creation now happens only in
    // resolveEmailToUserId, which always sets the verified email.
    app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: auth,
      payload: { name: "Jeff" },
    });
    expect(r.statusCode).toBe(404);
  });

  it("X-Forwarded-Email auto-provision creates a user with sensible defaults", async () => {
    // The canonical (and only) account-creation path; assert its shape
    // directly via GET /api/v1/users/me on a fresh DB.
    app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { "x-forwarded-email": "anon@example.com" },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.name).toBe("anon"); // local-part of email
    expect(body.timezone).toBe("UTC");
    expect(body.preferred_unit_system).toBe("metric");
    expect(body.dob).toBeNull();
    expect(body.height_cm).toBeNull();
    expect(body.sex).toBeNull();
  });

  it("a second allowlisted email provisions its own separate account", async () => {
    // Multi-user: every allowlisted email gets its own row. The first sign-in
    // on an empty table is bootstrapped as admin; subsequent ones are not.
    app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { "x-forwarded-email": "first@example.com" },
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { "x-forwarded-email": "second@example.com" },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().id).not.toBe(second.json().id);
    expect(first.json().email).toBe("first@example.com");
    expect(second.json().email).toBe("second@example.com");
  });
});
