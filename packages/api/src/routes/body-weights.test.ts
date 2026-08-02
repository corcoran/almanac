import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/body-weights", () => {
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

  it("POST creates a body weight and returns 201", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/body-weights",
      headers: auth,
      payload: { measured_on: "2026-05-12", weight_kg: 80 },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.weight_kg).toBe(80);
  });

  it("POST twice for same date returns same id (upsert)", async () => {
    app = setup();
    const r1 = await app.inject({
      method: "POST",
      url: "/api/v1/body-weights",
      headers: auth,
      payload: { measured_on: "2026-05-12", weight_kg: 80 },
    });
    const r2 = await app.inject({
      method: "POST",
      url: "/api/v1/body-weights",
      headers: auth,
      payload: { measured_on: "2026-05-12", weight_kg: 81 },
    });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r2.json().id).toBe(r1.json().id);
    expect(r2.json().weight_kg).toBe(81);
  });

  it("GET lists body weights", async () => {
    app = setup();
    await app.inject({
      method: "POST",
      url: "/api/v1/body-weights",
      headers: auth,
      payload: { measured_on: "2026-05-12", weight_kg: 80 },
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/body-weights", headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().length).toBe(1);
  });

  it("GET /:id 404 when missing", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/body-weights/999", headers: auth });
    expect(r.statusCode).toBe(404);
  });

  it("PATCH /:id updates fields", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/body-weights",
      headers: auth,
      payload: { measured_on: "2026-05-12", weight_kg: 80 },
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/body-weights/${id}`,
      headers: auth,
      payload: { weight_kg: 79.5 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().weight_kg).toBe(79.5);
  });

  it("DELETE /:id removes the row", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/body-weights",
      headers: auth,
      payload: { measured_on: "2026-05-12", weight_kg: 80 },
    });
    const id = c.json().id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/body-weights/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({
      method: "GET",
      url: `/api/v1/body-weights/${id}`,
      headers: auth,
    });
    expect(get.statusCode).toBe(404);
  });

  it("422 on bad input (missing weight_kg)", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/body-weights",
      headers: auth,
      payload: { measured_on: "2026-05-12" },
    });
    expect(r.statusCode).toBe(422);
  });

  it("401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/body-weights" });
    expect(r.statusCode).toBe(401);
  });
});
