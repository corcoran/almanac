import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/exercises", () => {
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
    a.db
      .prepare("INSERT INTO exercise_groups (user_id, name, display_order) VALUES (1, 'Push', 0)")
      .run();
    return a;
  }
  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  it("POST creates an exercise and returns 201", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/exercises",
      headers: auth,
      payload: { group_id: 1, name: "Bench Press" },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.name).toBe("Bench Press");
    expect(body.archived_at).toBeNull();
  });

  it("GET lists active exercises", async () => {
    app = setup();
    await app.inject({
      method: "POST",
      url: "/api/v1/exercises",
      headers: auth,
      payload: { group_id: 1, name: "Bench" },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/exercises",
      headers: auth,
      payload: { group_id: 1, name: "OHP" },
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/exercises", headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().length).toBe(2);
  });

  it("GET /:id 404 when missing", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/exercises/999", headers: auth });
    expect(r.statusCode).toBe(404);
  });

  it("PATCH /:id updates fields", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/exercises",
      headers: auth,
      payload: { group_id: 1, name: "Bench" },
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/exercises/${id}`,
      headers: auth,
      payload: { name: "Bench Press" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().name).toBe("Bench Press");
  });

  it("DELETE archives (soft-delete): excluded from default list, still findable", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/exercises",
      headers: auth,
      payload: { group_id: 1, name: "Bench" },
    });
    const id = c.json().id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/exercises/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    // Still findable by id
    const get = await app.inject({ method: "GET", url: `/api/v1/exercises/${id}`, headers: auth });
    expect(get.statusCode).toBe(200);
    expect(get.json().archived_at).not.toBeNull();
    // Default list excludes archived
    const list = await app.inject({ method: "GET", url: `/api/v1/exercises`, headers: auth });
    expect(list.json().length).toBe(0);
    // include_archived=true includes them
    const allList = await app.inject({
      method: "GET",
      url: `/api/v1/exercises?include_archived=true`,
      headers: auth,
    });
    expect(allList.json().length).toBe(1);
  });

  it("POST /:id/unarchive restores", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/exercises",
      headers: auth,
      payload: { group_id: 1, name: "Bench" },
    });
    const id = c.json().id;
    await app.inject({ method: "DELETE", url: `/api/v1/exercises/${id}`, headers: auth });
    const un = await app.inject({
      method: "POST",
      url: `/api/v1/exercises/${id}/unarchive`,
      headers: auth,
      payload: {},
    });
    expect(un.statusCode).toBe(204);
    const get = await app.inject({ method: "GET", url: `/api/v1/exercises/${id}`, headers: auth });
    expect(get.json().archived_at).toBeNull();
  });

  it("GET ?group_id filters", async () => {
    app = setup();
    app.db
      .prepare("INSERT INTO exercise_groups (user_id, name, display_order) VALUES (1, 'Pull', 1)")
      .run();
    await app.inject({
      method: "POST",
      url: "/api/v1/exercises",
      headers: auth,
      payload: { group_id: 1, name: "Bench" },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/exercises",
      headers: auth,
      payload: { group_id: 2, name: "Pull-up" },
    });
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/exercises?group_id=1",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().length).toBe(1);
    expect(r.json()[0].group_id).toBe(1);
  });

  it("422 on bad input (missing group_id)", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/exercises",
      headers: auth,
      payload: { name: "Bench" },
    });
    expect(r.statusCode).toBe(422);
  });

  it("401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/exercises" });
    expect(r.statusCode).toBe(401);
  });
});
