import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./server.js";

describe("idempotency", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it("returns the cached response on duplicate POST with same Idempotency-Key", async () => {
    app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    // Register a tiny test route that just echoes the body and a random id.
    app.post("/api/v1/_idempotent-echo", { config: { idempotent: true } }, async (req) => ({
      id: Math.random(),
      body: req.body,
    }));
    await app.ready();

    const headers = {
      "x-forwarded-email": "test@example.com",
      "idempotency-key": "abc123",
      "content-type": "application/json",
    };
    const r1 = await app.inject({
      method: "POST",
      url: "/api/v1/_idempotent-echo",
      headers,
      payload: { x: 1 },
    });
    const r2 = await app.inject({
      method: "POST",
      url: "/api/v1/_idempotent-echo",
      headers,
      payload: { x: 1 },
    });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.json()).toEqual(r2.json());
    // Replay should be marked.
    expect(r2.headers["idempotency-replayed"]).toBe("true");
  });

  it("non-idempotent routes pass through without caching", async () => {
    app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    app.post("/api/v1/_not-idempotent", async () => ({ id: Math.random() }));
    await app.ready();
    const headers = {
      "x-forwarded-email": "test@example.com",
      "idempotency-key": "xyz",
      "content-type": "application/json",
    };
    const r1 = await app.inject({
      method: "POST",
      url: "/api/v1/_not-idempotent",
      headers,
      payload: {},
    });
    const r2 = await app.inject({
      method: "POST",
      url: "/api/v1/_not-idempotent",
      headers,
      payload: {},
    });
    expect(r1.json()).not.toEqual(r2.json()); // different random ids
  });

  it("requests without Idempotency-Key are not cached", async () => {
    app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    app.post("/api/v1/_idempotent-echo", { config: { idempotent: true } }, async () => ({
      id: Math.random(),
    }));
    await app.ready();
    const headers = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };
    const r1 = await app.inject({
      method: "POST",
      url: "/api/v1/_idempotent-echo",
      headers,
      payload: {},
    });
    const r2 = await app.inject({
      method: "POST",
      url: "/api/v1/_idempotent-echo",
      headers,
      payload: {},
    });
    expect(r1.json()).not.toEqual(r2.json());
  });
});
