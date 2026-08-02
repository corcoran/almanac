import { ShareReportSchema } from "@almanac/core/schemas";
import { currentUserDate } from "@almanac/core/types";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

/**
 * Smoke tests for GET /api/v1/report — the assembled LLM-share report.
 * Report-assembly correctness lives in @almanac/core/signals/report.test.ts;
 * here we only verify the route plumbs DB → assembleReport → ShareReportSchema,
 * for both a populated user and an empty-state (bare) user.
 */
describe("/api/v1/report", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };
  const today = currentUserDate(new Date(), "UTC");

  function seedUser(a: FastifyInstance) {
    a.db
      .prepare(
        "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('Jeff', '1990-01-01', 180, 'male', 'test@example.com')",
      )
      .run();
  }

  it("GET /api/v1/report returns 200 + schema-valid body for a populated user", async () => {
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    app = a;
    seedUser(a);
    a.db
      .prepare(
        `INSERT INTO nutrition_phases
        (user_id, name, intent, phase_type, tdee_at_phase_start, tdee_source, deficit_kcal,
         daily_kcal_target, base_protein_g, base_carb_g, base_fat_g, started_on)
       VALUES (1, 'cut', 'cut', 'cut', 2400, 'user_asserted', -500, 1900, 180, 170, 60, '2026-05-01')`,
      )
      .run();
    a.db
      .prepare("INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, 82.0)")
      .run(today);
    a.db
      .prepare(
        `INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g)
         VALUES (1, ?, 1800, 180, 150, 60)`,
      )
      .run(`${today}T12:00:00Z`);

    const r = await app.inject({ method: "GET", url: "/api/v1/report", headers: auth });
    expect(r.statusCode).toBe(200);
    expect(ShareReportSchema.safeParse(r.json()).success).toBe(true);
  });

  it("GET /api/v1/report returns 200 + schema-valid body for a bare user (no phase)", async () => {
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    app = a;
    seedUser(a);

    const r = await app.inject({ method: "GET", url: "/api/v1/report", headers: auth });
    expect(r.statusCode).toBe(200);
    const parsed = ShareReportSchema.safeParse(r.json());
    expect(parsed.success).toBe(true);
    const body = r.json();
    expect(body.context.phase).toBeNull();
    expect(body.workouts.window_label).toBe("last_14_days");
  });
});
