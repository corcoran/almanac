import { findDailyNet } from "@almanac/core/repos";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/alcohol-sessions", () => {
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

  it("POST creates an alcohol session and returns 201", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/alcohol-sessions",
      headers: auth,
      payload: {
        started_at: "2026-05-12T20:00:00Z",
        drinks_count: 2,
        est_kcal: 300,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.drinks_count).toBe(2);
    expect(body.est_kcal).toBe(300);
  });

  it("GET lists sessions", async () => {
    app = setup();
    await app.inject({
      method: "POST",
      url: "/api/v1/alcohol-sessions",
      headers: auth,
      payload: { started_at: "2026-05-12T20:00:00Z", drinks_count: 2, est_kcal: 300 },
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/alcohol-sessions", headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().length).toBe(1);
  });

  it("GET /:id 404 when missing", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/alcohol-sessions/999",
      headers: auth,
    });
    expect(r.statusCode).toBe(404);
  });

  it("PATCH /:id updates fields", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/alcohol-sessions",
      headers: auth,
      payload: { started_at: "2026-05-12T20:00:00Z", drinks_count: 2, est_kcal: 300 },
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/alcohol-sessions/${id}`,
      headers: auth,
      payload: { drinks_count: 3, est_kcal: 450 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().drinks_count).toBe(3);
    expect(r.json().est_kcal).toBe(450);
  });

  it("DELETE /:id removes the row", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/alcohol-sessions",
      headers: auth,
      payload: { started_at: "2026-05-12T20:00:00Z", drinks_count: 2, est_kcal: 300 },
    });
    const id = c.json().id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/alcohol-sessions/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({
      method: "GET",
      url: `/api/v1/alcohol-sessions/${id}`,
      headers: auth,
    });
    expect(get.statusCode).toBe(404);
  });

  it("422 on bad input (missing drinks_count)", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/alcohol-sessions",
      headers: auth,
      payload: { started_at: "2026-05-12T20:00:00Z", est_kcal: 300 },
    });
    expect(r.statusCode).toBe(422);
  });

  it("401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/alcohol-sessions" });
    expect(r.statusCode).toBe(401);
  });

  describe("daily_net snapshot upkeep", () => {
    const sessionPayload = (started_at: string, est_kcal: number) => ({
      started_at,
      drinks_count: 2,
      est_kcal,
    });

    it("POST recomputes the day's net snapshot", async () => {
      app = setup();
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/alcohol-sessions",
        headers: auth,
        payload: sessionPayload("2026-06-02T18:00:00Z", 300),
      });
      expect(r.statusCode).toBe(201);
      const snapshot = findDailyNet(app.db, 1, "2026-06-02");
      expect(snapshot).not.toBeNull();
      expect(snapshot?.intake_kcal).toBe(300);
    });

    it("DELETE of a day's only alcohol session removes the net snapshot", async () => {
      app = setup();
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/alcohol-sessions",
        headers: auth,
        payload: sessionPayload("2026-06-02T18:00:00Z", 300),
      });
      expect(findDailyNet(app.db, 1, "2026-06-02")).not.toBeNull();
      const id = created.json().id;
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/alcohol-sessions/${id}`,
        headers: auth,
      });
      expect(del.statusCode).toBe(204);
      expect(findDailyNet(app.db, 1, "2026-06-02")).toBeNull();
    });

    it("PATCH moving a session to a new day recomputes both days", async () => {
      app = setup();
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/alcohol-sessions",
        headers: auth,
        payload: sessionPayload("2026-06-02T18:00:00Z", 300),
      });
      expect(findDailyNet(app.db, 1, "2026-06-02")).not.toBeNull();
      const id = created.json().id;
      const r = await app.inject({
        method: "PATCH",
        url: `/api/v1/alcohol-sessions/${id}`,
        headers: auth,
        payload: { started_at: "2026-06-04T18:00:00Z" },
      });
      expect(r.statusCode).toBe(200);
      // New day B has the snapshot...
      const dayB = findDailyNet(app.db, 1, "2026-06-04");
      expect(dayB).not.toBeNull();
      expect(dayB?.intake_kcal).toBe(300);
      // ...and old day A is gone (it now has no intake).
      expect(findDailyNet(app.db, 1, "2026-06-02")).toBeNull();
    });
  });

  it("naked local started_at is interpreted in the user's profile timezone", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    // 2026-05-08 20:00 in Toronto (EDT, UTC-4) == 2026-05-09T00:00:00Z.
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/alcohol-sessions",
      headers: auth,
      payload: {
        started_at: "2026-05-08T20:00:00",
        drinks_count: 2,
        est_kcal: 300,
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().started_at).toBe("2026-05-09T00:00:00.000Z");
  });

  it("POST normalizes naked local ended_at against the user's timezone", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    // 2026-05-08 23:30 Toronto (EDT, UTC-4) → 2026-05-09T03:30:00Z.
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/alcohol-sessions",
      headers: auth,
      payload: {
        started_at: "2026-05-08T20:00:00",
        ended_at: "2026-05-08T23:30:00",
        drinks_count: 2,
        est_kcal: 300,
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().started_at).toBe("2026-05-09T00:00:00.000Z");
    expect(r.json().ended_at).toBe("2026-05-09T03:30:00.000Z");
  });

  it("PATCH normalizes naked local started_at against the user's timezone", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/alcohol-sessions",
      headers: auth,
      payload: { started_at: "2026-05-12T20:00:00Z", drinks_count: 2, est_kcal: 300 },
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/alcohol-sessions/${id}`,
      headers: auth,
      payload: { started_at: "2026-05-08T20:00:00" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().started_at).toBe("2026-05-09T00:00:00.000Z");
  });

  it("PATCH normalizes naked local ended_at against the user's timezone", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/alcohol-sessions",
      headers: auth,
      payload: { started_at: "2026-05-12T20:00:00Z", drinks_count: 2, est_kcal: 300 },
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/alcohol-sessions/${id}`,
      headers: auth,
      payload: { ended_at: "2026-05-08T23:30:00" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().ended_at).toBe("2026-05-09T03:30:00.000Z");
  });
});
