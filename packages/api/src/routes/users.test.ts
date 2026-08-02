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

  it("POST /api/v1/users 409s once the proxy has auto-provisioned a user", async () => {
    // Under the new auth shape, an X-Forwarded-Email request auto-provisions
    // a user during the preHandler. By the time POST /api/v1/users runs its
    // body, that user already exists — so the explicit bootstrap path
    // returns 409. (Auto-provision replaces this route in proxied
    // deployments; the route remains for backward compat.)
    app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: auth,
      payload: {
        name: "Jeff",
        dob: "1981-07-16",
        height_cm: 183,
        sex: "male",
        timezone: "America/Toronto",
      },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("conflict");
  });

  it("X-Forwarded-Email auto-provision creates a user with sensible defaults", async () => {
    // Replaces the old "POST /api/v1/users accepts minimal payload" — the
    // auto-provision path is now the canonical bootstrap; assert its
    // shape directly via GET /api/v1/users/me on a fresh DB.
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

  it("POST /api/v1/users returns 409 when a user already exists", async () => {
    app = setup(); // setup() already inserted a user
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: auth,
      payload: { name: "Second" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("conflict");
  });

  it("POST /api/v1/users rejects unknown timezone (422)", async () => {
    app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: auth,
      payload: { name: "TZ", timezone: "Mars/Olympus_Mons" },
    });
    expect(r.statusCode).toBe(422);
  });
});
