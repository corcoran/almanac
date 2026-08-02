import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetAccomplishmentHistoryTool } from "./get-accomplishment-history.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

const fixture = {
  accomplishments: [
    {
      code: "weigh_in_streak",
      earned_on: "2026-06-01",
      value: 14,
      message: "14-day weigh-in streak",
      details: {},
      prior_best: { earned_on: "2026-05-01", value: 7 },
    },
  ],
  aggregates: {
    total: 1,
    by_type: {
      weigh_in_streak: 1,
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
      weigh_in_streak: { value: 14, earned_on: "2026-06-01" },
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

describe("get_accomplishment_history", () => {
  it("GETs the history endpoint and adds summary_lines and aggregates_summary", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { preferred_unit_system: "metric" }))
      .mockResolvedValueOnce(mockJsonResponse(200, fixture));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetAccomplishmentHistoryTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({})) as typeof fixture & {
      summary_lines: string[];
      aggregates_summary: string;
    };
    expect(nthCall(fetchImpl, 1)[0]).toBe("http://x/api/v1/signals/accomplishments/history");
    expect(result.summary_lines.length).toBe(1);
    expect(result.aggregates_summary).toContain("1 wins all-time");
  });

  it("renders the 'most down' aggregate in lb for an imperial user", async () => {
    const imperialFixture = {
      accomplishments: [],
      aggregates: {
        ...fixture.aggregates,
        best_by_type: {
          ...fixture.aggregates.best_by_type,
          weight_milestone: { value: 8, earned_on: "2026-06-06" },
        },
      },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { preferred_unit_system: "imperial" }))
      .mockResolvedValueOnce(mockJsonResponse(200, imperialFixture));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetAccomplishmentHistoryTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({})) as { aggregates_summary: string };
    // 8 kg → 17.6 lb
    expect(result.aggregates_summary).toContain("most down 17.6lb");
  });

  it("has readOnlyHint annotation", () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetAccomplishmentHistoryTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("passes through the accomplishments array and aggregates unchanged", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { preferred_unit_system: "metric" }))
      .mockResolvedValueOnce(mockJsonResponse(200, fixture));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetAccomplishmentHistoryTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({})) as typeof fixture & {
      summary_lines: string[];
      aggregates_summary: string;
    };
    expect(result.accomplishments).toEqual(fixture.accomplishments);
    expect(result.aggregates).toEqual(fixture.aggregates);
  });
});
