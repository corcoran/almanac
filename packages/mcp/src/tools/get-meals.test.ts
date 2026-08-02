import { defined, nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetMealsTool } from "./get-meals.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_meals", () => {
  it("defaults to last 7 days and returns meals + count", async () => {
    const meals = [
      {
        id: 1,
        eaten_at: "2026-05-12T08:00:00Z",
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
        name: "oatmeal",
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, meals));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMealsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const before = Date.now();
    const result = await tool.handler({});

    const r = result as { meals: unknown[]; count: number };
    expect(r.meals).toEqual(meals);
    expect(r.count).toBe(1);

    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url).toContain("/api/v1/meals?");
    const fromStr = defined(new URL(url).searchParams.get("from"), "from");
    const fromMs = new Date(fromStr).getTime();
    const expectedFromMs = before - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(fromMs - expectedFromMs)).toBeLessThan(2000);
  });

  it("respects from_days_ago override", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMealsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const before = Date.now();
    await tool.handler({ from_days_ago: 14 });

    const url = nthCall(fetchImpl, 0)[0] as string;
    const fromMs = new Date(defined(new URL(url).searchParams.get("from"), "from")).getTime();
    expect(Math.abs(fromMs - (before - 14 * 24 * 60 * 60 * 1000))).toBeLessThan(2000);
  });

  it("respects explicit from/to/limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMealsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await tool.handler({
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-04-08T00:00:00.000Z",
      limit: 50,
    });

    const params = new URL(nthCall(fetchImpl, 0)[0] as string).searchParams;
    expect(params.get("from")).toBe("2026-04-01T00:00:00.000Z");
    expect(params.get("to")).toBe("2026-04-08T00:00:00.000Z");
    expect(params.get("limit")).toBe("50");
  });

  it("forwards from_date/to_date to the querystring and skips from/from_days_ago default", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, []));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetMealsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await tool.handler({ from_date: "2026-05-08", to_date: "2026-05-08" });

    const url = nthCall(fetchImpl, 0)[0] as string;
    const params = new URL(url).searchParams;
    expect(params.get("from_date")).toBe("2026-05-08");
    expect(params.get("to_date")).toBe("2026-05-08");
    // from_date takes precedence — no implicit `from` instant should leak through.
    expect(params.get("from")).toBeNull();
  });
});
