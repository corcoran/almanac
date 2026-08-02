import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/workout-templates", () => {
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
    a.db.prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (1, 1, 'Bench')").run();
    a.db.prepare("INSERT INTO exercises (user_id, group_id, name) VALUES (1, 1, 'OHP')").run();
    return a;
  }
  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  it("POST creates a template with items", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/workout-templates",
      headers: auth,
      payload: {
        name: "Push Day",
        items: [
          { exercise_id: 1, display_order: 0, default_sets: 3 },
          { exercise_id: 2, display_order: 1, default_sets: 3, default_reps: 8 },
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.name).toBe("Push Day");
    expect(body.items.length).toBe(2);
  });

  it("GET lists active templates", async () => {
    app = setup();
    await app.inject({
      method: "POST",
      url: "/api/v1/workout-templates",
      headers: auth,
      payload: { name: "A", items: [] },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/workout-templates",
      headers: auth,
      payload: { name: "B", items: [] },
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/workout-templates", headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().length).toBe(2);
  });

  it("GET lists return items inline for each template", async () => {
    app = setup();
    await app.inject({
      method: "POST",
      url: "/api/v1/workout-templates",
      headers: auth,
      payload: {
        name: "Push Day",
        items: [
          { exercise_id: 1, display_order: 0, default_sets: 3 },
          { exercise_id: 2, display_order: 1, default_sets: 3, default_reps: 8 },
        ],
      },
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/workout-templates", headers: auth });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.length).toBe(1);
    expect(body[0].items.length).toBe(2);
    expect(body[0].items[0].exercise_id).toBe(1);
  });

  it("GET ?include_archived=true returns archived templates too", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/workout-templates",
      headers: auth,
      payload: { name: "Push", items: [] },
    });
    const id = c.json().id;
    await app.inject({ method: "DELETE", url: `/api/v1/workout-templates/${id}`, headers: auth });

    // Default excludes archived.
    const def = await app.inject({
      method: "GET",
      url: "/api/v1/workout-templates",
      headers: auth,
    });
    expect(def.json().length).toBe(0);

    // Including archived returns the row.
    const all = await app.inject({
      method: "GET",
      url: "/api/v1/workout-templates?include_archived=true",
      headers: auth,
    });
    expect(all.statusCode).toBe(200);
    const body = all.json();
    expect(body.length).toBe(1);
    expect(body[0].archived_at).not.toBeNull();
  });

  it("GET /:id 404 when missing", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/workout-templates/999",
      headers: auth,
    });
    expect(r.statusCode).toBe(404);
  });

  it("PATCH /:id updates scalar fields", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/workout-templates",
      headers: auth,
      payload: { name: "Push", items: [] },
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/workout-templates/${id}`,
      headers: auth,
      payload: { name: "Push Day" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().name).toBe("Push Day");
  });

  it("PUT /:id/items replaces template items", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/workout-templates",
      headers: auth,
      payload: {
        name: "Push",
        items: [{ exercise_id: 1, display_order: 0, default_sets: 3 }],
      },
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "PUT",
      url: `/api/v1/workout-templates/${id}/items`,
      headers: auth,
      payload: {
        items: [{ exercise_id: 2, display_order: 0, default_sets: 5, default_reps: 5 }],
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.items.length).toBe(1);
    expect(body.items[0].exercise_id).toBe(2);
    expect(body.items[0].default_sets).toBe(5);
  });

  it("DELETE archives (soft-delete)", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/workout-templates",
      headers: auth,
      payload: { name: "Push", items: [] },
    });
    const id = c.json().id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/workout-templates/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    // Still findable by id
    const get = await app.inject({
      method: "GET",
      url: `/api/v1/workout-templates/${id}`,
      headers: auth,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().archived_at).not.toBeNull();
    // Default list excludes archived
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/workout-templates`,
      headers: auth,
    });
    expect(list.json().length).toBe(0);
  });

  it("POST /:id/unarchive restores", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/workout-templates",
      headers: auth,
      payload: { name: "Push", items: [] },
    });
    const id = c.json().id;
    await app.inject({ method: "DELETE", url: `/api/v1/workout-templates/${id}`, headers: auth });
    const un = await app.inject({
      method: "POST",
      url: `/api/v1/workout-templates/${id}/unarchive`,
      headers: auth,
      payload: {},
    });
    expect(un.statusCode).toBe(204);
    const get = await app.inject({
      method: "GET",
      url: `/api/v1/workout-templates/${id}`,
      headers: auth,
    });
    expect(get.json().archived_at).toBeNull();
  });

  it("422 on bad input (missing name)", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/workout-templates",
      headers: auth,
      payload: { items: [] },
    });
    expect(r.statusCode).toBe(422);
  });

  it("401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/workout-templates" });
    expect(r.statusCode).toBe(401);
  });
});
