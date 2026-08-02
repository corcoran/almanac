import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeLogMealFromStoredTool } from "./log-meal-from-stored.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("log_meal_from_stored", () => {
  it("fetches the stored meal, POSTs its macros to /meals, returns a log_meal-shaped summary", async () => {
    const fetchImpl = vi
      .fn()
      // 0) makeCurrentUserId resolves the user via GET /api/v1/users/me FIRST.
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      // 1) GET the stored definition
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          id: 7,
          name: "breakfast",
          kcal: 350,
          protein_g: 25,
          carb_g: 30,
          fat_g: 15,
          description: "eggs",
        }),
      )
      // 2) POST the logged meal
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 42,
          eaten_at: "2026-06-13T08:00:00.000Z",
          name: "breakfast",
          kcal: 350,
          protein_g: 25,
          carb_g: 30,
          fat_g: 15,
        }),
      )
      // 3) GET the day macro summary
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          date: "2026-06-13",
          day_totals: { kcal: 350, protein_g: 25, carb_g: 30, fat_g: 15 },
          day_target: null,
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogMealFromStoredTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({
      stored_meal_id: 7,
      eaten_at: "2026-06-13T08:00:00Z",
    })) as { id: number; day: string; from_stored_meal_id: number; day_totals: { kcal: number } };
    expect(result.id).toBe(42);
    expect(result.day).toBe("2026-06-13");
    expect(result.from_stored_meal_id).toBe(7);
    expect(result.day_totals.kcal).toBe(350);
    // Call 1 is the GET of the stored definition; call 2 is the POST to /meals
    // carrying the copied macros. (Call 0 is the users/me lookup.)
    expect(String(nthCall(fetchImpl, 1)[0])).toContain("/api/v1/stored-meals/7");
    const postCall = nthCall(fetchImpl, 2);
    expect(String(postCall[0])).toContain("/api/v1/meals");
    const postBody = JSON.parse(String((postCall[1] as { body?: string }).body ?? "{}"));
    expect(postBody.kcal).toBe(350);
    expect(postBody.name).toBe("breakfast");
    // Call 3 is the macro-summary GET (same endpoint log_meal uses).
    expect(String(nthCall(fetchImpl, 3)[0])).toContain("/api/v1/signals/macros?at=");
  });

  it("summarizes against the target when an active phase is present", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, name: "Jeff" }))
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          id: 7,
          name: "breakfast",
          kcal: 350,
          protein_g: 25,
          carb_g: 30,
          fat_g: 15,
          description: "eggs",
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 42,
          eaten_at: "2026-06-13T08:00:00.000Z",
          name: "breakfast",
          kcal: 350,
          protein_g: 25,
          carb_g: 30,
          fat_g: 15,
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          date: "2026-06-13",
          day_totals: { kcal: 350, protein_g: 25, carb_g: 30, fat_g: 15 },
          day_target: {
            target: { kcal: 2000, protein_g: 165, carb_g: 230, fat_g: 75 },
            maintenance: { kcal: 2500 },
            intake: { kcal: 350, protein_g: 25, carb_g: 30, fat_g: 15 },
            observed: {},
          },
        }),
      );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const { makeCurrentUserId } = await import("../current-user.js");
    const tool = makeLogMealFromStoredTool({
      api,
      currentUserId: makeCurrentUserId(api, () => "alm_test"),
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({
      stored_meal_id: 7,
      eaten_at: "2026-06-13T08:00:00Z",
    })) as { summary: string };
    // summarizeMeal renders the day total against the target: "350/2000 (18%)".
    expect(result.summary).toContain("350/2000");
  });
});
