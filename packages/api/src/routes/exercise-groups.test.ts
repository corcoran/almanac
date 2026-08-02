import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/exercise-groups", () => {
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

  it("POST creates a group and returns 201 with the row", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/exercise-groups",
      headers: auth,
      payload: { name: "Push", display_order: 1 },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.name).toBe("Push");
    expect(body.user_id).toBe(1);
  });

  it("GET lists groups for the user", async () => {
    app = setup();
    await app.inject({
      method: "POST",
      url: "/api/v1/exercise-groups",
      headers: auth,
      payload: { name: "Push" },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/exercise-groups",
      headers: auth,
      payload: { name: "Pull" },
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/exercise-groups", headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().length).toBe(2);
  });

  it("GET /:id 404 when missing", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/exercise-groups/999",
      headers: auth,
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("not_found");
  });

  it("PATCH /:id updates fields", async () => {
    app = setup();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/exercise-groups",
      headers: auth,
      payload: { name: "Push" },
    });
    const id = created.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/exercise-groups/${id}`,
      headers: auth,
      payload: { name: "Push Day" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().name).toBe("Push Day");
  });

  it("DELETE /:id removes the row", async () => {
    app = setup();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/exercise-groups",
      headers: auth,
      payload: { name: "Push" },
    });
    const id = created.json().id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/exercise-groups/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({
      method: "GET",
      url: `/api/v1/exercise-groups/${id}`,
      headers: auth,
    });
    expect(get.statusCode).toBe(404);
  });

  it("422 on bad input (missing name)", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/exercise-groups",
      headers: auth,
      payload: {},
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("validation_failed");
  });

  it("401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/exercise-groups" });
    expect(r.statusCode).toBe(401);
  });
});
