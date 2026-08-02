import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeLogMealTool } from "./log-meal.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

function makeDayTarget(target_kcal: number) {
  return {
    target: { kcal: target_kcal, protein_g: 165, carb_g: 230, fat_g: 75 },
    maintenance: { kcal: target_kcal + 500 },
    intake: { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 },
    observed: {
      cardio_kcal: 0,
      workout_kcal: 0,
      vs_target: 0,
      vs_maintenance: 0,
      status: "on_track" as const,
    },
  };
}

describe("log_meal", () => {
  it("POSTs to /api/v1/meals, fetches the meal's user-day, returns summary with the new day_target shape", async () => {
    const fetchImpl = vi
      .fn()
      // /api/v1/users/me (cached by currentUserId)
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      // POST /api/v1/meals
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 5,
          eaten_at: "2026-05-12T08:00:00.000Z",
          kcal: 350,
          protein_g: 25,
          carb_g: 30,
          fat_g: 15,
        }),
      )
      // GET /api/v1/signals/macros?at=<eaten_at>
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          date: "2026-05-12",
          day_totals: {
            kcal: 350,
            protein_g: 25,
            carb_g: 30,
            fat_g: 15,
            kcal_from_food: 350,
            kcal_from_alcohol: 0,
          },
          day_target: makeDayTarget(1900),
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogMealTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    const r = result as {
      id: number;
      day: string;
      summary: string;
      day_totals: { kcal: number };
      day_target: { target: { kcal: number } };
    };
    expect(r.id).toBe(5);
    expect(r.day).toBe("2026-05-12");
    expect(r.summary).toContain("350 kcal");
    expect(r.summary).toContain("2026-05-12");
    expect(r.day_totals.kcal).toBe(350);
    expect(r.day_target.target.kcal).toBe(1900);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    // Verify the POST included an idempotency key.
    const postCall = nthCall(fetchImpl, 1);
    expect(postCall[1].headers["idempotency-key"]).toBeDefined();
    expect(postCall[1].headers["idempotency-key"]).toMatch(/^meal:1:[a-f0-9]{64}$/);

    // Verify the GET hit the macros-by-instant endpoint, not /api/v1/signals/today.
    expect(nthCall(fetchImpl, 2)[0]).toContain("/api/v1/signals/macros?at=");
  });

  it("logging a meal eaten days ago summarizes that day's totals, not today's", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      // POST /api/v1/meals
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 7,
          eaten_at: "2026-05-08T20:20:00.000Z",
          kcal: 620,
          protein_g: 30,
          carb_g: 80,
          fat_g: 25,
          name: null,
          notes: null,
        }),
      )
      // GET /api/v1/signals/macros?at=<eaten_at>
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          date: "2026-05-08",
          day_totals: {
            kcal: 1798,
            protein_g: 142,
            carb_g: 180,
            fat_g: 65,
            kcal_from_food: 1798,
            kcal_from_alcohol: 0,
          },
          day_target: makeDayTarget(2350),
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogMealTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({
      eaten_at: "2026-05-08T16:20:00-04:00",
      kcal: 620,
      protein_g: 30,
      carb_g: 80,
      fat_g: 25,
    })) as { day: string; summary: string };
    expect(result.day).toBe("2026-05-08");
    expect(result.summary).toContain("2026-05-08");
    expect(result.summary).toContain("1798/2350");
    expect(result.summary).not.toContain("Today");
    // Verify the URL was the new endpoint and carried the canonical UTC eaten_at.
    expect(nthCall(fetchImpl, 2)[0]).toContain("/api/v1/signals/macros?at=");
    expect(nthCall(fetchImpl, 2)[0]).toContain(encodeURIComponent("2026-05-08T20:20:00.000Z"));
  });

  it("idempotency key is stable for identical payloads", async () => {
    const mealResp = {
      id: 5,
      eaten_at: "2026-05-12T08:00:00.000Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    };
    const dayResp = {
      date: "2026-05-12",
      day_totals: {
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
        kcal_from_food: 350,
        kcal_from_alcohol: 0,
      },
      day_target: makeDayTarget(1900),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(mockJsonResponse(201, mealResp))
      .mockResolvedValueOnce(mockJsonResponse(200, dayResp))
      .mockResolvedValueOnce(mockJsonResponse(201, mealResp))
      .mockResolvedValueOnce(mockJsonResponse(200, dayResp));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogMealTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const input = {
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    };
    await tool.handler(input);
    await tool.handler(input);
    const key1 = (nthCall(fetchImpl, 1)[1] as { headers: Record<string, string> }).headers[
      "idempotency-key"
    ];
    const key2 = (nthCall(fetchImpl, 3)[1] as { headers: Record<string, string> }).headers[
      "idempotency-key"
    ];
    expect(key1).toBe(key2);
  });

  it("falls back to a 'no active nutrition phase' summary when day_target is null", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 11,
          eaten_at: "2026-05-12T08:00:00.000Z",
          kcal: 350,
          protein_g: 25,
          carb_g: 30,
          fat_g: 15,
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          date: "2026-05-12",
          day_totals: {
            kcal: 350,
            protein_g: 25,
            carb_g: 30,
            fat_g: 15,
            kcal_from_food: 350,
            kcal_from_alcohol: 0,
          },
          day_target: null,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogMealTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    })) as { summary: string; day_target: unknown | null };
    expect(r.day_target).toBeNull();
    expect(r.summary).toContain("no active nutrition phase");
  });
});
