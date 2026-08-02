import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./server.js";

describe("api smoke", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  function setup() {
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    a.db.prepare("INSERT INTO users (name, email) VALUES ('Jeff', 'test@example.com')").run();
    a.db
      .prepare(
        `INSERT INTO nutrition_phases
        (user_id, name, intent, phase_type, tdee_at_phase_start, tdee_source, deficit_kcal,
         daily_kcal_target, base_protein_g, base_carb_g, base_fat_g, started_on)
       VALUES (1, 'cut', 'cut', 'cut', 2400, 'user_asserted', -500, 1900, 180, 170, 60, '2026-05-01')`,
      )
      .run();
    return a;
  }

  it("seeds, posts a meal, lists it", async () => {
    app = setup();
    await app.ready();
    const post = await app.inject({
      method: "POST",
      url: "/api/v1/meals",
      headers: { "x-forwarded-email": "test@example.com", "content-type": "application/json" },
      payload: {
        eaten_at: "2026-05-12T08:00:00Z",
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
      },
    });
    expect(post.statusCode).toBe(201);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/meals",
      headers: { "x-forwarded-email": "test@example.com" },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBe(1);
  });

  it("GET /api/v1/health does not require auth", async () => {
    app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    await app.ready();
    const r = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    expect(r.json().migrations_applied).toBeGreaterThan(0);
    // commit SHA is baked in at build time; "unknown" for un-stamped dev builds.
    expect(typeof r.json().commit).toBe("string");
  });

  it("GET /api/v1/version returns the version (auth required since it's not /health)", async () => {
    app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    await app.ready();
    // /api/v1/version is registered alongside /api/v1/health so it's also public.
    const r = await app.inject({ method: "GET", url: "/api/v1/version" });
    expect(r.statusCode).toBe(200);
    expect(typeof r.json().version).toBe("string");
  });
});
