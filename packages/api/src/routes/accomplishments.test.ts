import { addDaysIso, currentUserDate } from "@almanac/core/types";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/signals/accomplishments", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  function setup() {
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    a.db
      .prepare(
        "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('Jeff','1990-01-01',180,'male','test@example.com')",
      )
      .run();
    return a;
  }
  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  it("returns an empty list when no wins earned", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/accomplishments",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ accomplishments: [] });
  });

  it("earns a weigh_in_streak after logging 7 consecutive days via the API", async () => {
    app = setup();
    // The seeded user's timezone defaults to UTC. Derive the 7 weigh-in dates
    // from the same user-local "today" the detector uses (currentUserDate over
    // the real now), so the streak counts back to today and the win's earned_on
    // is trivially inside the recent window — robust against the 4am rollover.
    const today = currentUserDate(new Date(), "UTC");
    const days = [6, 5, 4, 3, 2, 1, 0].map((k) => addDaysIso(today, -k));
    for (const d of days) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/body-weights",
        headers: auth,
        payload: { measured_on: d, weight_kg: 82 },
      });
      expect(r.statusCode).toBe(201);
    }
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/signals/accomplishments",
      headers: auth,
    });
    const body = r.json();
    expect(body.accomplishments.some((a: { code: string }) => a.code === "weigh_in_streak")).toBe(
      true,
    );
  });

  it("surfaces weigh_in_total via the endpoint after the 50th weigh-in is logged", async () => {
    app = setup();
    // Derive the 50 weigh-in dates from the same user-local "today" the detector
    // uses (currentUserDate over the real now), so the 50th (most recent) weigh-in
    // is dated today and its earned_on falls trivially inside the recent window.
    const today = currentUserDate(new Date(), "UTC");
    for (let i = 0; i < 50; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/body-weights",
        headers: auth,
        payload: { measured_on: addDaysIso(today, -(49 - i)), weight_kg: 80 },
      });
      expect(r.statusCode).toBe(201);
    }
    const read = await app.inject({
      method: "GET",
      url: "/api/v1/signals/accomplishments",
      headers: auth,
    });
    expect(read.statusCode).toBe(200);
    const body = read.json() as { accomplishments: Array<{ code: string; value: number }> };
    expect(body.accomplishments.some((a) => a.code === "weigh_in_total" && a.value === 50)).toBe(
      true,
    );
  });

  it("GET /v1/signals/accomplishments/history returns full timeline + aggregates", async () => {
    app = setup();
    // Seed 7 consecutive weigh-ins to earn a weigh_in_streak win
    const today = currentUserDate(new Date(), "UTC");
    const days = [6, 5, 4, 3, 2, 1, 0].map((k) => addDaysIso(today, -k));
    for (const d of days) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/body-weights",
        headers: auth,
        payload: { measured_on: d, weight_kg: 82 },
      });
      expect(r.statusCode).toBe(201);
    }
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/signals/accomplishments/history",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.accomplishments)).toBe(true);
    expect(body.aggregates.total).toBeGreaterThanOrEqual(1);
    expect(body.aggregates).toHaveProperty("by_type");
    expect(body.aggregates).toHaveProperty("best_by_type");
  });

  it("multiple win types from different write paths coexist in history aggregates", async () => {
    // End-to-end cross-feature check: a weigh-in streak (body-weight write path)
    // and a sleep_recovery density win (sleep write path) earned in the same
    // session must BOTH persist and surface, with by_type counts and the ordinal
    // best_by_type populated independently per code. Guards the "codes coexist"
    // invariant the whole accomplishments batch depends on.
    app = setup();
    const today = currentUserDate(new Date(), "UTC");

    // 7 consecutive weigh-ins → weigh_in_streak (value 7).
    for (const d of [6, 5, 4, 3, 2, 1, 0].map((k) => addDaysIso(today, -k))) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/body-weights",
        headers: auth,
        payload: { measured_on: d, weight_kg: 82 },
      });
      expect(r.statusCode).toBe(201);
    }
    // 4 of the last 7 nights at 8h+ → sleep_recovery density (value 4).
    for (const d of [3, 2, 1, 0].map((k) => addDaysIso(today, -k))) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/sleep-logs",
        headers: auth,
        payload: { slept_on: d, hours: 8 },
      });
      expect(r.statusCode).toBe(201);
    }

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/signals/accomplishments/history",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      accomplishments: Array<{ code: string }>;
      aggregates: {
        total: number;
        by_type: Record<string, number>;
        best_by_type: Record<string, { value: number; earned_on: string } | null>;
      };
    };
    const codes = new Set(body.accomplishments.map((a) => a.code));
    expect(codes.has("weigh_in_streak")).toBe(true);
    expect(codes.has("sleep_recovery")).toBe(true);
    // by_type counts the two codes independently.
    expect(body.aggregates.by_type.weigh_in_streak).toBeGreaterThanOrEqual(1);
    expect(body.aggregates.by_type.sleep_recovery).toBeGreaterThanOrEqual(1);
    // Both are ordinal codes → best_by_type carries a real "best" entry for each.
    expect(body.aggregates.best_by_type.weigh_in_streak?.value).toBe(7);
    expect(body.aggregates.best_by_type.sleep_recovery?.value).toBe(4);
  });

  it("GET /v1/signals/accomplishments/history requires auth", async () => {
    app = setup();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/signals/accomplishments/history",
      // no auth headers
    });
    expect(res.statusCode).toBe(401);
  });
});
