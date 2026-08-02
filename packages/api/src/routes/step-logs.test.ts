import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/v1/step-logs", () => {
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

  it("POST creates a step log and returns 201 with computed est_kcal", async () => {
    app = setup();
    // Seed a body weight so est_kcal is computed predictably.
    await app.inject({
      method: "POST",
      url: "/api/v1/body-weights",
      headers: auth,
      payload: { measured_on: "2026-05-20", weight_kg: 80 },
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/step-logs",
      headers: auth,
      payload: { on_date: "2026-05-24", steps: 10000 },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.steps).toBe(10000);
    expect(body.est_kcal).toBe(400);
    expect(body.source).toBe("manual");
  });

  it("POST honors caller-supplied est_kcal", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/step-logs",
      headers: auth,
      payload: { on_date: "2026-05-24", steps: 10000, est_kcal: 999 },
    });
    expect(r.json().est_kcal).toBe(999);
  });

  it("POST twice for same date returns same id (upsert)", async () => {
    app = setup();
    const r1 = await app.inject({
      method: "POST",
      url: "/api/v1/step-logs",
      headers: auth,
      payload: { on_date: "2026-05-24", steps: 5000 },
    });
    const r2 = await app.inject({
      method: "POST",
      url: "/api/v1/step-logs",
      headers: auth,
      payload: { on_date: "2026-05-24", steps: 12000 },
    });
    expect(r2.json().id).toBe(r1.json().id);
    expect(r2.json().steps).toBe(12000);
  });

  it("GET lists step logs with from/to windowing and on_date DESC ordering", async () => {
    app = setup();
    for (const d of ["2026-05-20", "2026-05-22", "2026-05-24"]) {
      await app.inject({
        method: "POST",
        url: "/api/v1/step-logs",
        headers: auth,
        payload: { on_date: d, steps: 8000 },
      });
    }
    // `to` is exclusive (per repo contract), so include 2026-05-24 by passing 2026-05-25.
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/step-logs?from=2026-05-21&to=2026-05-25",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{ on_date: string }>;
    expect(rows.map((r) => r.on_date)).toEqual(["2026-05-24", "2026-05-22"]);
  });

  it("GET /:id returns the row", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/step-logs",
      headers: auth,
      payload: { on_date: "2026-05-24", steps: 8000 },
    });
    const id = c.json().id;
    const r = await app.inject({ method: "GET", url: `/api/v1/step-logs/${id}`, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().steps).toBe(8000);
  });

  it("GET /:id 404 when missing", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/step-logs/999", headers: auth });
    expect(r.statusCode).toBe(404);
  });

  it("GET /by-date/:on_date returns the row", async () => {
    app = setup();
    await app.inject({
      method: "POST",
      url: "/api/v1/step-logs",
      headers: auth,
      payload: { on_date: "2026-05-24", steps: 8000 },
    });
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/step-logs/by-date/2026-05-24",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().steps).toBe(8000);
  });

  it("GET /by-date/:on_date 404 when missing", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/step-logs/by-date/2026-05-24",
      headers: auth,
    });
    expect(r.statusCode).toBe(404);
  });

  it("PATCH /:id updates fields", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/step-logs",
      headers: auth,
      payload: { on_date: "2026-05-24", steps: 1000 },
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/step-logs/${id}`,
      headers: auth,
      payload: { steps: 5000, notes: "fixed" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().steps).toBe(5000);
    expect(r.json().notes).toBe("fixed");
  });

  it("DELETE /:id removes the row", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/step-logs",
      headers: auth,
      payload: { on_date: "2026-05-24", steps: 1000 },
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "DELETE",
      url: `/api/v1/step-logs/${id}`,
      headers: auth,
    });
    expect(r.statusCode).toBe(204);
    const g = await app.inject({ method: "GET", url: `/api/v1/step-logs/${id}`, headers: auth });
    expect(g.statusCode).toBe(404);
  });

  it("POST with negative steps returns 422", async () => {
    // Zod validation failures surface as 422 via the central error handler
    // (see sleep.test.ts for the same pattern). The plan called this 400, but
    // the established convention in this codebase is 422 for body-validation.
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/step-logs",
      headers: auth,
      payload: { on_date: "2026-05-24", steps: -100 },
    });
    expect(r.statusCode).toBe(422);
  });
});
