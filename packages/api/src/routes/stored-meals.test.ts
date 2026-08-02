import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/stored-meals", () => {
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
  const body = {
    name: "breakfast",
    kcal: 350,
    protein_g: 25,
    carb_g: 30,
    fat_g: 15,
    description: "eggs",
  };

  it("POST creates a stored meal and returns 201 with the row", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/stored-meals",
      headers: auth,
      payload: body,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().name).toBe("breakfast");
    expect(r.json().kcal).toBe(350);
  });

  it("POST is upsert-on-name (overwrites, same id)", async () => {
    app = setup();
    const first = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stored-meals",
        headers: auth,
        payload: body,
      })
    ).json();
    const second = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stored-meals",
        headers: auth,
        payload: { ...body, kcal: 500 },
      })
    ).json();
    expect(second.id).toBe(first.id);
    expect(second.kcal).toBe(500);
    const list = (
      await app.inject({ method: "GET", url: "/api/v1/stored-meals", headers: auth })
    ).json();
    expect(list).toHaveLength(1);
  });

  it("GET lists, GET :id fetches, 404 on unknown id", async () => {
    app = setup();
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stored-meals",
        headers: auth,
        payload: body,
      })
    ).json();
    const list = await app.inject({ method: "GET", url: "/api/v1/stored-meals", headers: auth });
    expect(list.json()).toHaveLength(1);
    const one = await app.inject({
      method: "GET",
      url: `/api/v1/stored-meals/${created.id}`,
      headers: auth,
    });
    expect(one.json().name).toBe("breakfast");
    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/stored-meals/99999",
      headers: auth,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("PATCH renames; collision returns 409", async () => {
    app = setup();
    const bfast = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stored-meals",
        headers: auth,
        payload: body,
      })
    ).json();
    await app.inject({
      method: "POST",
      url: "/api/v1/stored-meals",
      headers: auth,
      payload: { ...body, name: "lunch" },
    });
    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/stored-meals/${bfast.id}`,
      headers: auth,
      payload: { name: "weekday breakfast" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe("weekday breakfast");
    const collide = await app.inject({
      method: "PATCH",
      url: `/api/v1/stored-meals/${bfast.id}`,
      headers: auth,
      payload: { name: "lunch" },
    });
    expect(collide.statusCode).toBe(409);
  });

  it("PATCH unknown id returns 404", async () => {
    app = setup();
    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/stored-meals/99999",
      headers: auth,
      payload: { kcal: 1 },
    });
    expect(r.statusCode).toBe(404);
  });

  it("DELETE returns 204 and removes the row", async () => {
    app = setup();
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stored-meals",
        headers: auth,
        payload: body,
      })
    ).json();
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/stored-meals/${created.id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: "GET", url: "/api/v1/stored-meals", headers: auth });
    expect(after.json()).toHaveLength(0);
  });
});
