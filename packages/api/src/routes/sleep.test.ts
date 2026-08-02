import { addDaysIso, currentUserDate } from "@almanac/core/types";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/sleep-logs", () => {
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

  it("POST creates a sleep log and returns 201", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/sleep-logs",
      headers: auth,
      payload: { slept_on: "2026-05-12", hours: 7.5, quality: 4 },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.hours).toBe(7.5);
    expect(body.quality).toBe(4);
  });

  it("POST twice for same date returns same id (upsert)", async () => {
    app = setup();
    const r1 = await app.inject({
      method: "POST",
      url: "/api/v1/sleep-logs",
      headers: auth,
      payload: { slept_on: "2026-05-12", hours: 7 },
    });
    const r2 = await app.inject({
      method: "POST",
      url: "/api/v1/sleep-logs",
      headers: auth,
      payload: { slept_on: "2026-05-12", hours: 8 },
    });
    expect(r2.json().id).toBe(r1.json().id);
    expect(r2.json().hours).toBe(8);
  });

  it("GET lists sleep logs", async () => {
    app = setup();
    await app.inject({
      method: "POST",
      url: "/api/v1/sleep-logs",
      headers: auth,
      payload: { slept_on: "2026-05-12", hours: 7.5 },
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/sleep-logs", headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().length).toBe(1);
  });

  it("GET /:id 404 when missing", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/sleep-logs/999", headers: auth });
    expect(r.statusCode).toBe(404);
  });

  it("PATCH /:id updates fields", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/sleep-logs",
      headers: auth,
      payload: { slept_on: "2026-05-12", hours: 7 },
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/sleep-logs/${id}`,
      headers: auth,
      payload: { hours: 8 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().hours).toBe(8);
  });

  it("DELETE /:id removes the row", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/sleep-logs",
      headers: auth,
      payload: { slept_on: "2026-05-12", hours: 7 },
    });
    const id = c.json().id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/sleep-logs/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: "GET", url: `/api/v1/sleep-logs/${id}`, headers: auth });
    expect(get.statusCode).toBe(404);
  });

  it("422 on bad input (missing hours)", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/sleep-logs",
      headers: auth,
      payload: { slept_on: "2026-05-12" },
    });
    expect(r.statusCode).toBe(422);
  });

  it("401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/sleep-logs" });
    expect(r.statusCode).toBe(401);
  });

  it("logging sleep that completes 4-of-7 surfaces a sleep_recovery win", async () => {
    app = setup();
    // The seeded user's timezone defaults to UTC. Derive the 4 dates from the
    // same user-local "today" the detector uses so the density window fires on
    // the final POST. The edge-trigger logic requires goodToday>=4 AND
    // goodYesterday<4, so 4 consecutive nights ending today is the minimal trigger.
    const today = currentUserDate(new Date(), "UTC");
    const nights = [3, 2, 1, 0].map((k) => addDaysIso(today, -k));
    for (const slept_on of nights) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/sleep-logs",
        headers: auth,
        payload: { slept_on, hours: 8 },
      });
      expect(res.statusCode).toBe(201);
    }
    const wins = await app.inject({
      method: "GET",
      url: "/api/v1/signals/accomplishments",
      headers: auth,
    });
    expect(wins.statusCode).toBe(200);
    const body = wins.json() as {
      accomplishments: Array<{ code: string; value: number }>;
    };
    const win = body.accomplishments.find((a) => a.code === "sleep_recovery");
    expect(win).toBeDefined();
    // Density flavor, good-night count = 4 (not the debt_cleared 0 sentinel).
    expect(win?.value).toBe(4);
  });
});
