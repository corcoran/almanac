import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useTemplatesStore } from "./templates.js";

describe("useTemplatesStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle", () => {
    const store = useTemplatesStore();
    expect(store.status).toBe("idle");
    expect(store.templates).toEqual([]);
    expect(store.recommended_template_id).toBeNull();
    expect(store.error).toBeNull();
  });

  it("transitions idle -> loading -> ready and derives recommended_template_id", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/v1/workout-templates")) {
        return Promise.resolve(
          new Response(JSON.stringify(makeTemplatesFixture()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.includes("/v1/signals/recommend-template")) {
        return Promise.resolve(
          new Response(JSON.stringify(makeRecommendFixture()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTemplatesStore();
    const promise = store.load(client);
    expect(store.status).toBe("loading");
    await promise;
    expect(store.status).toBe("ready");
    expect(store.templates).toHaveLength(3);
    expect(store.templates[0]?.name).toBe("PUSH A");
    // First recommendation in the fixture is template_id=2.
    expect(store.recommended_template_id).toBe(2);
  });

  it("recommended_template_id is null when recommendations array is empty", async () => {
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/v1/workout-templates")) {
        return Promise.resolve(
          new Response(JSON.stringify(makeTemplatesFixture()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ recommendations: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTemplatesStore();
    await store.load(client);
    expect(store.status).toBe("ready");
    expect(store.recommended_template_id).toBeNull();
  });

  it("reload re-fetches templates + recommendation", async () => {
    // First two calls (one templates, one recommend) return the initial
    // fixture (recommendation lead = template_id=2). Subsequent calls return
    // the post-workout fixture (recommendation lead = template_id=1).
    let recommendCallCount = 0;
    const fetchImpl = vi.fn((input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/v1/workout-templates")) {
        return Promise.resolve(
          new Response(JSON.stringify(makeTemplatesFixture()), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.includes("/v1/signals/recommend-template")) {
        recommendCallCount += 1;
        const body =
          recommendCallCount === 1 ? makeRecommendFixture() : makeRecommendFixtureAfterWorkout();
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTemplatesStore();

    await store.load(client);
    expect(store.recommended_template_id).toBe(2);

    await store.reload(client);
    expect(store.status).toBe("ready");
    expect(store.recommended_template_id).toBe(1);
    // Sanity check: reload actually went to the network for both endpoints.
    expect(recommendCallCount).toBe(2);
  });

  it("transitions to error on http failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useTemplatesStore();
    await store.load(client);
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });
});

function makeTemplatesFixture() {
  return [
    {
      id: 1,
      user_id: 1,
      name: "PUSH A",
      notes: null,
      archived_at: null,
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: 2,
      user_id: 1,
      name: "PULL A",
      notes: null,
      archived_at: null,
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: 3,
      user_id: 1,
      name: "LEGS A",
      notes: null,
      archived_at: null,
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
}

function makeRecommendFixture() {
  return {
    recommendations: [
      {
        template_id: 2,
        template_name: "PULL A",
        score: 0.92,
        confidence: "actionable",
        avg_recovery_hours: 96,
        reasoning: {
          prime_groups_hit: ["back"],
          in_window_groups_hit: [],
          too_soon_groups_hit: [],
          neutral_groups_hit: ["biceps"],
          overdue_groups_hit: [],
        },
      },
      {
        template_id: 1,
        template_name: "PUSH A",
        score: 0.71,
        confidence: "actionable",
        avg_recovery_hours: 72,
        reasoning: {
          prime_groups_hit: ["chest"],
          in_window_groups_hit: [],
          too_soon_groups_hit: [],
          neutral_groups_hit: [],
          overdue_groups_hit: [],
        },
      },
    ],
  };
}

// Mirrors what we'd expect after just finishing a PULL session: PUSH A is now
// the top recommendation, PULL A drops below.
function makeRecommendFixtureAfterWorkout() {
  return {
    recommendations: [
      {
        template_id: 1,
        template_name: "PUSH A",
        score: 0.95,
        confidence: "actionable",
        avg_recovery_hours: 96,
        reasoning: {
          prime_groups_hit: ["chest"],
          in_window_groups_hit: [],
          too_soon_groups_hit: [],
          neutral_groups_hit: [],
          overdue_groups_hit: [],
        },
      },
      {
        template_id: 2,
        template_name: "PULL A",
        score: 0.45,
        confidence: "actionable",
        avg_recovery_hours: 0.5,
        reasoning: {
          prime_groups_hit: [],
          in_window_groups_hit: [],
          too_soon_groups_hit: ["back"],
          neutral_groups_hit: ["biceps"],
          overdue_groups_hit: [],
        },
      },
    ],
  };
}
