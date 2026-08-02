import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/v1/untracked-periods", () => {
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

  it("POST creates a period and returns 201", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/untracked-periods",
      headers: auth,
      payload: { started_on: "2026-05-01", ended_on: "2026-05-07", reason: "vacation" },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.reason).toBe("vacation");
    expect(body.notes).toBeNull();
  });

  it("POST rejects ended_on < started_on with 422", async () => {
    // The .refine() on CreateUntrackedPeriodInputSchema surfaces through the
    // central error handler as a 422 validation_failed — the established
    // body-validation convention in this codebase (see step-logs.test.ts).
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/untracked-periods",
      headers: auth,
      payload: { started_on: "2026-05-07", ended_on: "2026-05-01", reason: "sick" },
    });
    expect(r.statusCode).toBe(422);
  });

  it("POST rejects an overlapping period with 422 period_overlap", async () => {
    app = setup();
    await app.inject({
      method: "POST",
      url: "/api/v1/untracked-periods",
      headers: auth,
      payload: { started_on: "2026-05-01", ended_on: "2026-05-07", reason: "vacation" },
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/untracked-periods",
      headers: auth,
      payload: { started_on: "2026-05-05", ended_on: "2026-05-10", reason: "deload" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toBe("period_overlap");
    expect(r.json().conflicting_period.started_on).toBe("2026-05-01");
  });

  it("GET defaults to the last 90 days, excluding older periods", async () => {
    app = setup();
    const today = new Date().toISOString().slice(0, 10);
    const recent = (() => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 5);
      return d.toISOString().slice(0, 10);
    })();
    const old = (() => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 200);
      return d.toISOString().slice(0, 10);
    })();
    // Recent period goes through the route; the >90d-old one is seeded
    // directly so it sits clearly outside the default window.
    await app.inject({
      method: "POST",
      url: "/api/v1/untracked-periods",
      headers: auth,
      payload: { started_on: recent, ended_on: recent, reason: "vacation" },
    });
    app.db
      .prepare(
        "INSERT INTO untracked_periods (user_id, started_on, ended_on, reason) VALUES (1, ?, ?, 'sick')",
      )
      .run(old, old);

    const r = await app.inject({ method: "GET", url: "/api/v1/untracked-periods", headers: auth });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.length).toBe(1);
    expect(body[0].started_on).toBe(recent);
  });

  it("DELETE removes a period and returns 204", async () => {
    app = setup();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/untracked-periods",
      headers: auth,
      payload: { started_on: "2026-05-01", ended_on: "2026-05-03", reason: "vacation" },
    });
    const id = created.json().id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/untracked-periods/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/untracked-periods",
      headers: auth,
    });
    expect(list.json().length).toBe(0);
  });

  it("round-trip: create clears unexplained_gap; delete restores it", async () => {
    app = setup();
    const today = new Date().toISOString().slice(0, 10);
    const addDays = (iso: string, n: number) => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    // Seed daily weights ending 5 days ago → a current 5-day gap (>= 4).
    let d = addDays(today, -30);
    const lastLogged = addDays(today, -5);
    while (d <= lastLogged) {
      await app.inject({
        method: "POST",
        url: "/api/v1/body-weights",
        headers: auth,
        payload: { measured_on: d, weight_kg: 80 },
      });
      d = addDays(d, 1);
    }

    // Before: a gap is surfaced.
    const before = await app.inject({
      method: "GET",
      url: "/api/v1/signals/today",
      headers: auth,
    });
    expect(before.json().unexplained_gap).not.toBeNull();
    expect(before.json().unexplained_gap.from).toBe(addDays(lastLogged, 1));

    // Create a period covering the gap.
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/untracked-periods",
      headers: auth,
      payload: { started_on: addDays(lastLogged, 1), ended_on: today, reason: "vacation" },
    });
    expect(created.statusCode).toBe(201);

    // After: gap cleared.
    const after = await app.inject({
      method: "GET",
      url: "/api/v1/signals/today",
      headers: auth,
    });
    expect(after.json().unexplained_gap).toBeNull();

    // Delete: gap restored.
    await app.inject({
      method: "DELETE",
      url: `/api/v1/untracked-periods/${created.json().id}`,
      headers: auth,
    });
    const restored = await app.inject({
      method: "GET",
      url: "/api/v1/signals/today",
      headers: auth,
    });
    expect(restored.json().unexplained_gap).not.toBeNull();
  });
});
