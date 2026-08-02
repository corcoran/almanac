import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/cardio-sessions", () => {
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

  it("POST creates a cardio session and returns 201", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/cardio-sessions",
      headers: auth,
      payload: {
        started_at: "2026-05-12T07:00:00Z",
        duration_min: 30,
        modality: "run",
        est_kcal: 350,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.modality).toBe("run");
  });

  it("GET lists sessions", async () => {
    app = setup();
    await app.inject({
      method: "POST",
      url: "/api/v1/cardio-sessions",
      headers: auth,
      payload: { started_at: "2026-05-12T07:00:00Z", est_kcal: 350 },
    });
    const r = await app.inject({ method: "GET", url: "/api/v1/cardio-sessions", headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().length).toBe(1);
  });

  it("GET /:id 404 when missing", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/cardio-sessions/999",
      headers: auth,
    });
    expect(r.statusCode).toBe(404);
  });

  it("PATCH /:id updates fields", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/cardio-sessions",
      headers: auth,
      payload: { started_at: "2026-05-12T07:00:00Z", est_kcal: 350 },
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/cardio-sessions/${id}`,
      headers: auth,
      payload: { est_kcal: 400 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().est_kcal).toBe(400);
  });

  it("DELETE /:id removes the row", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/cardio-sessions",
      headers: auth,
      payload: { started_at: "2026-05-12T07:00:00Z", est_kcal: 350 },
    });
    const id = c.json().id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/cardio-sessions/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({
      method: "GET",
      url: `/api/v1/cardio-sessions/${id}`,
      headers: auth,
    });
    expect(get.statusCode).toBe(404);
  });

  it("422 on bad input (missing est_kcal)", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/cardio-sessions",
      headers: auth,
      payload: { started_at: "2026-05-12T07:00:00Z" },
    });
    expect(r.statusCode).toBe(422);
  });

  it("401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/cardio-sessions" });
    expect(r.statusCode).toBe(401);
  });

  it("PATCH normalizes naked local started_at against the user's timezone", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/cardio-sessions",
      headers: auth,
      payload: { started_at: "2026-05-12T07:00:00Z", est_kcal: 350 },
    });
    const id = c.json().id;
    // 2026-05-08 16:20 in Toronto (EDT, UTC-4) == 2026-05-08T20:20:00Z.
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/cardio-sessions/${id}`,
      headers: auth,
      payload: { started_at: "2026-05-08T16:20:00" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().started_at).toBe("2026-05-08T20:20:00.000Z");
  });

  it("naked local started_at is interpreted in the user's profile timezone", async () => {
    app = setup();
    app.db.prepare("UPDATE users SET timezone = ? WHERE id = ?").run("America/Toronto", 1);
    // 2026-05-08 16:20 in Toronto (EDT, UTC-4) == 2026-05-08T20:20:00Z.
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/cardio-sessions",
      headers: auth,
      payload: {
        started_at: "2026-05-08T16:20:00",
        duration_min: 30,
        modality: "run",
        est_kcal: 350,
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().started_at).toBe("2026-05-08T20:20:00.000Z");
  });

  // --- HR-derived kcal estimate enrichment --------------------------------
  // The session-level math is exhaustively covered in
  // core/signals/cardio-kcal-estimate.test.ts. Here we just verify the
  // route correctly wires up the helper for every entry point.
  describe("kcal_estimate enrichment", () => {
    function seedWeight(a: FastifyInstance) {
      a.db
        .prepare(
          "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, '2026-05-20', 80)",
        )
        .run();
    }

    it("POST returns kcal_estimate and estimate_warning when avg_hr is provided", async () => {
      app = setup();
      seedWeight(app);
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/cardio-sessions",
        headers: auth,
        payload: {
          started_at: "2026-05-21T07:00:00Z",
          duration_min: 30,
          modality: "run",
          avg_hr: 150,
          est_kcal: 800, // intentionally inflated to trip the warning
        },
      });
      expect(r.statusCode).toBe(201);
      const body = r.json();
      expect(body.kcal_estimate).not.toBeNull();
      expect(body.kcal_estimate.basis).toBe("keytel_and_mets");
      expect(body.kcal_estimate.est_kcal_hr).toBeGreaterThan(0);
      expect(body.estimate_warning).not.toBeNull();
      expect(body.estimate_warning.delta_pct).toBeGreaterThan(20);
      expect(body.estimate_warning.message).toContain("higher than");
    });

    it("POST returns null kcal_estimate when avg_hr is not provided", async () => {
      app = setup();
      seedWeight(app);
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/cardio-sessions",
        headers: auth,
        payload: {
          started_at: "2026-05-21T07:00:00Z",
          duration_min: 30,
          modality: "run",
          est_kcal: 300,
        },
      });
      expect(r.statusCode).toBe(201);
      const body = r.json();
      expect(body.kcal_estimate).toBeNull();
      expect(body.estimate_warning).toBeNull();
    });

    it("POST returns null estimate_warning when user_est_kcal is close to hr_est_kcal", async () => {
      app = setup();
      seedWeight(app);
      // First POST a session to discover what hr_est_kcal lands at for this
      // profile, then POST another with est_kcal close to that figure.
      const probe = await app.inject({
        method: "POST",
        url: "/api/v1/cardio-sessions",
        headers: auth,
        payload: {
          started_at: "2026-05-21T07:00:00Z",
          duration_min: 30,
          modality: "run",
          avg_hr: 150,
          est_kcal: 100, // doesn't matter — we want the hr estimate
        },
      });
      const hrEst = probe.json().kcal_estimate.est_kcal_hr;

      const r = await app.inject({
        method: "POST",
        url: "/api/v1/cardio-sessions",
        headers: auth,
        payload: {
          started_at: "2026-05-21T08:00:00Z",
          duration_min: 30,
          modality: "run",
          avg_hr: 150,
          est_kcal: hrEst, // exact match → 0% delta
        },
      });
      expect(r.json().estimate_warning).toBeNull();
    });

    it("falls back to mets_only when the user has no weight logged", async () => {
      app = setup(); // no seedWeight — weight is null
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/cardio-sessions",
        headers: auth,
        payload: {
          started_at: "2026-05-21T07:00:00Z",
          duration_min: 30,
          modality: "run",
          avg_hr: 150,
          est_kcal: 300,
        },
      });
      const body = r.json();
      // Keytel needs weight — without it, basis flips to mets_only.
      expect(body.kcal_estimate.basis).toBe("mets_only");
      expect(body.kcal_estimate.components.keytel_kcal).toBeNull();
    });

    it("GET /:id and GET (list) both include the enrichment fields", async () => {
      app = setup();
      seedWeight(app);
      const c = await app.inject({
        method: "POST",
        url: "/api/v1/cardio-sessions",
        headers: auth,
        payload: {
          started_at: "2026-05-21T07:00:00Z",
          duration_min: 30,
          modality: "run",
          avg_hr: 150,
          est_kcal: 350,
        },
      });
      const id = c.json().id;

      const single = await app.inject({
        method: "GET",
        url: `/api/v1/cardio-sessions/${id}`,
        headers: auth,
      });
      expect(single.json().kcal_estimate).not.toBeNull();

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/cardio-sessions",
        headers: auth,
      });
      expect(list.json()[0].kcal_estimate).not.toBeNull();
    });
  });
});
