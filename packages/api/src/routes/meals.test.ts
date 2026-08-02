import { findDailyNet } from "@almanac/core/repos";
import { at } from "@almanac/core/test-support";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/meals", () => {
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
      .prepare(
        `INSERT INTO nutrition_phases
        (user_id, name, intent, phase_type, tdee_at_phase_start, tdee_source, deficit_kcal,
         daily_kcal_target, base_protein_g, base_carb_g, base_fat_g, started_on)
       VALUES (1, 'cut', 'cut', 'cut', 2400, 'user_asserted', -500, 1900, 180, 170, 60, '2026-05-01')`,
      )
      .run();
    return a;
  }
  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  it("POST creates a meal and returns 201 with the row", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/meals",
      headers: auth,
      payload: {
        eaten_at: "2026-05-12T08:00:00Z",
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.kcal).toBe(350);
    expect(body.user_id).toBe(1);
  });

  it("GET /api/v1/meals lists meals for the user", async () => {
    app = setup();
    await app.inject({
      method: "POST",
      url: "/api/v1/meals",
      headers: auth,
      payload: {
        eaten_at: "2026-05-12T08:00:00Z",
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
      },
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/meals", headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().length).toBe(1);
  });

  it("GET /api/v1/meals/:id 404 when missing", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/meals/999", headers: auth });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("not_found");
  });

  it("PATCH /api/v1/meals/:id updates fields", async () => {
    app = setup();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/meals",
      headers: auth,
      payload: {
        eaten_at: "2026-05-12T08:00:00Z",
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
      },
    });
    const id = created.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/meals/${id}`,
      headers: auth,
      payload: { kcal: 400 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().kcal).toBe(400);
    expect(r.json().protein_g).toBe(25);
  });

  it("DELETE /api/v1/meals/:id removes the row", async () => {
    app = setup();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/meals",
      headers: auth,
      payload: {
        eaten_at: "2026-05-12T08:00:00Z",
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
      },
    });
    const id = created.json().id;
    const del = await app.inject({ method: "DELETE", url: `/api/v1/meals/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: "GET", url: `/api/v1/meals/${id}`, headers: auth });
    expect(get.statusCode).toBe(404);
  });

  it("422 on bad input (missing required field)", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/meals",
      headers: auth,
      payload: { eaten_at: "2026-05-12T08:00:00Z" }, // missing kcal/protein_g/etc.
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("validation_failed");
  });

  it("401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/meals" });
    expect(r.statusCode).toBe(401);
  });

  it("naked local eaten_at is interpreted in the user's profile timezone", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    // 2026-05-08 16:20 in Toronto (EDT, UTC-4) == 2026-05-08T20:20:00Z.
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/meals",
      headers: auth,
      payload: {
        eaten_at: "2026-05-08T16:20:00",
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().eaten_at).toBe("2026-05-08T20:20:00.000Z");
  });

  it("PATCH normalizes naked local eaten_at against the user's timezone", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/meals",
      headers: auth,
      payload: {
        eaten_at: "2026-05-12T08:00:00Z",
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
      },
    });
    const id = created.json().id;
    // 2026-05-08 16:20 in Toronto (EDT, UTC-4) == 2026-05-08T20:20:00Z.
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/meals/${id}`,
      headers: auth,
      payload: { eaten_at: "2026-05-08T16:20:00" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().eaten_at).toBe("2026-05-08T20:20:00.000Z");
  });

  it("from_date/to_date resolve the window in the user's timezone", async () => {
    app = setup();
    // Move the user to Toronto time so the user-day boundary is 04:00 EDT.
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    // Seed two meals straddling the May 8 user-day boundary (04:00 EDT = 08:00 UTC).
    //   - mealA at 2026-05-09T01:00:00Z = 21:00 EDT May 8 → falls inside May 8 user-day
    //   - mealB at 2026-05-09T10:00:00Z = 06:00 EDT May 9 → falls inside May 9 user-day
    for (const eaten_at of ["2026-05-09T01:00:00Z", "2026-05-09T10:00:00Z"]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/meals",
        headers: auth,
        payload: { eaten_at, kcal: 100, protein_g: 10, carb_g: 10, fat_g: 5 },
      });
      expect(r.statusCode).toBe(201);
    }
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/meals?from_date=2026-05-08&to_date=2026-05-08",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Array<{ eaten_at: string }>;
    expect(body.length).toBe(1);
    expect(at(body, 0).eaten_at).toBe("2026-05-09T01:00:00.000Z");
  });

  describe("daily_net snapshot upkeep", () => {
    const mealPayload = (eaten_at: string, kcal: number) => ({
      eaten_at,
      kcal,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });

    it("POST recomputes the day's net snapshot", async () => {
      app = setup();
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/meals",
        headers: auth,
        payload: mealPayload("2026-06-02T12:00:00Z", 350),
      });
      expect(r.statusCode).toBe(201);
      const snapshot = findDailyNet(app.db, 1, "2026-06-02");
      expect(snapshot).not.toBeNull();
      expect(snapshot?.intake_kcal).toBe(350);
    });

    it("DELETE of a day's only meal removes the net snapshot", async () => {
      app = setup();
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/meals",
        headers: auth,
        payload: mealPayload("2026-06-02T12:00:00Z", 350),
      });
      expect(findDailyNet(app.db, 1, "2026-06-02")).not.toBeNull();
      const id = created.json().id;
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/meals/${id}`,
        headers: auth,
      });
      expect(del.statusCode).toBe(204);
      expect(findDailyNet(app.db, 1, "2026-06-02")).toBeNull();
    });

    it("PATCH moving a meal to a new day recomputes both days", async () => {
      app = setup();
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/meals",
        headers: auth,
        payload: mealPayload("2026-06-02T12:00:00Z", 350),
      });
      expect(findDailyNet(app.db, 1, "2026-06-02")).not.toBeNull();
      const id = created.json().id;
      const r = await app.inject({
        method: "PATCH",
        url: `/api/v1/meals/${id}`,
        headers: auth,
        payload: { eaten_at: "2026-06-04T12:00:00Z" },
      });
      expect(r.statusCode).toBe(200);
      // New day B has the snapshot...
      const dayB = findDailyNet(app.db, 1, "2026-06-04");
      expect(dayB).not.toBeNull();
      expect(dayB?.intake_kcal).toBe(350);
      // ...and old day A is gone (it now has no meals).
      expect(findDailyNet(app.db, 1, "2026-06-02")).toBeNull();
    });
  });
});
