import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetTodayContextTool } from "./get-today-context.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_today_context", () => {
  it("GETs /api/v1/signals/today and returns the response", async () => {
    const todayBody = {
      today: {
        kcal_in: 1100,
        protein_g_in: 78,
        // Post-TDEE-refactor: structured target/maintenance/intake/observed.
        target: { kcal: 1900, protein_g: 180, carb_g: 170, fat_g: 60 },
        maintenance: { kcal: 2400 },
        intake: { kcal: 1100, protein_g: 78, carb_g: 100, fat_g: 30 },
        observed: {
          cardio_kcal: 0,
          workout_kcal: 0,
          vs_target: -800,
          vs_maintenance: -1300,
          status: "on_track",
        },
      },
    };
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url === "http://x/api/v1/signals/today") {
        return Promise.resolve(mockJsonResponse(200, todayBody));
      }
      if (url === "http://x/api/v1/users/me") {
        return Promise.resolve(mockJsonResponse(200, { about_me: null }));
      }
      throw new Error(`unexpected url ${url}`);
    });
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetTodayContextTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({});
    expect(result).toEqual({ ...todayBody, about_me: null });
    expect(nthCall(fetchImpl, 0)[0]).toBe("http://x/api/v1/signals/today");
    expect(nthCall(fetchImpl, 0)[1].method).toBe("GET");
  });

  it("attaches about_me from the profile while keeping the snapshot fields", async () => {
    const todayBody = { today: { kcal_in: 1100 } };
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url === "http://x/api/v1/signals/today") {
        return Promise.resolve(mockJsonResponse(200, todayBody));
      }
      if (url === "http://x/api/v1/users/me") {
        return Promise.resolve(mockJsonResponse(200, { about_me: "cyclist" }));
      }
      throw new Error(`unexpected url ${url}`);
    });
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetTodayContextTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = (await tool.handler({})) as {
      today?: { kcal_in: number };
      about_me?: string | null;
    };

    expect(result.about_me).toBe("cyclist");
    expect(result.today).toEqual(todayBody.today);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("still returns the snapshot (about_me null) when the profile fetch fails", async () => {
    const todayBody = { today: { kcal_in: 1100 } };
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url === "http://x/api/v1/signals/today") {
        return Promise.resolve(mockJsonResponse(200, todayBody));
      }
      if (url === "http://x/api/v1/users/me") {
        return Promise.reject(new Error("profile fetch boom"));
      }
      throw new Error(`unexpected url ${url}`);
    });
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetTodayContextTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = (await tool.handler({})) as {
      today?: { kcal_in: number };
      about_me?: string | null;
    };

    expect(result.today).toEqual(todayBody.today);
    expect(result.about_me).toBeNull();
  });
});
