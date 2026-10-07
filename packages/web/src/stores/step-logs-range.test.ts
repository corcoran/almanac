import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useStepLogsRangeStore } from "./step-logs-range.js";

function row(id: number, on_date: string, steps: number) {
  return {
    id,
    user_id: 1,
    on_date,
    steps,
    est_kcal: 300,
    source: "manual",
    notes: null,
    created_at: `${on_date}T23:00:00Z`,
  };
}

describe("useStepLogsRangeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("fetches the range and sorts oldest first", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toContain("/v1/step-logs?from=2026-09-22&to=2026-10-06");
      return Promise.resolve(
        new Response(JSON.stringify([row(2, "2026-10-05", 9412), row(1, "2026-10-01", 5000)]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const store = useStepLogsRangeStore();
    await store.load(new ApiClient({ baseUrl: "/api", fetchImpl }), "2026-09-22", "2026-10-06");
    expect(store.status).toBe("ready");
    expect(store.data.map((d) => d.on_date)).toEqual(["2026-10-01", "2026-10-05"]);
  });

  it("transitions to error on HTTP 500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const store = useStepLogsRangeStore();
    await store.load(new ApiClient({ baseUrl: "/api", fetchImpl }), "2026-09-22", "2026-10-06");
    expect(store.status).toBe("error");
  });
});
