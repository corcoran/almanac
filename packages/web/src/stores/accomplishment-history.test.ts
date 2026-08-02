import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useAccomplishmentHistoryStore } from "./accomplishment-history.js";

describe("useAccomplishmentHistoryStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle", () => {
    const store = useAccomplishmentHistoryStore();
    expect(store.status).toBe("idle");
    expect(store.data).toBeNull();
    expect(store.error).toBeNull();
  });

  it("transitions idle -> loading -> ready on success", async () => {
    const fixture = {
      accomplishments: [],
      aggregates: {
        total: 0,
        by_type: {
          weigh_in_streak: 0,
          workout_consistency: 0,
          target_adherence_streak: 0,
          weight_milestone: 0,
          tdee_measured: 0,
          strength_pr: 0,
          phase_complete: 0,
          phase_halfway: 0,
          workout_total: 0,
          volume_total: 0,
          meal_total: 0,
          weigh_in_total: 0,
          sleep_recovery: 0,
        },
        best_by_type: {
          weigh_in_streak: null,
          workout_consistency: null,
          target_adherence_streak: null,
          weight_milestone: null,
          tdee_measured: null,
          strength_pr: null,
          phase_complete: null,
          phase_halfway: null,
          workout_total: null,
          volume_total: null,
          meal_total: null,
          weigh_in_total: null,
          sleep_recovery: null,
        },
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useAccomplishmentHistoryStore();
    const promise = store.load(client);
    expect(store.status).toBe("loading");
    await promise;
    expect(store.status).toBe("ready");
    expect(store.data).toEqual(fixture);
  });

  it("transitions to error on http failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useAccomplishmentHistoryStore();
    await store.load(client);
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });
});
