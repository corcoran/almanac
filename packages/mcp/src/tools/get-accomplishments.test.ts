import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetAccomplishmentsTool } from "./get-accomplishments.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

const fixture = {
  accomplishments: [
    {
      code: "weigh_in_streak",
      earned_on: "2026-05-21",
      value: 14,
      message: "14-day weigh-in streak",
      details: { streak_days: 14 },
      prior_best: { earned_on: "2026-05-01", value: 10 },
    },
  ],
};

describe("get_accomplishments", () => {
  it("GETs the endpoint and adds a celebratory summary_line with prior best", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { preferred_unit_system: "metric" }))
      .mockResolvedValueOnce(mockJsonResponse(200, fixture));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetAccomplishmentsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({})) as typeof fixture & { summary_lines: string[] };
    expect(nthCall(fetchImpl, 1)[0]).toBe("http://x/api/v1/signals/accomplishments");
    expect(result.summary_lines[0]).toContain("14-day weigh-in streak");
    expect(result.summary_lines[0]).toContain("previous best was 10");
  });

  it("formats summary_line without prior_best when prior_best is null", async () => {
    const nopriorFixture = {
      accomplishments: [
        {
          code: "weigh_in_streak",
          earned_on: "2026-05-21",
          value: 14,
          message: "14-day weigh-in streak",
          details: { streak_days: 14 },
          prior_best: null,
        },
      ],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { preferred_unit_system: "metric" }))
      .mockResolvedValueOnce(mockJsonResponse(200, nopriorFixture));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetAccomplishmentsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({})) as typeof nopriorFixture & { summary_lines: string[] };
    expect(result.summary_lines[0]).toContain("14-day weigh-in streak");
    expect(result.summary_lines[0]).not.toContain("previous best");
  });

  it("renders the prior_best summary in lb for an imperial user", async () => {
    const prFixture = {
      accomplishments: [
        {
          code: "strength_pr",
          earned_on: "2026-06-08",
          value: 96.5,
          message: "New PR: Bench e1RM 212.7 lb",
          details: { exercise_id: 3, exercise_name: "Bench" },
          prior_best: { earned_on: "2026-06-03", value: 93.5 },
        },
      ],
    };
    const fetchImpl = vi
      .fn()
      // 1st: profile fetch → imperial; 2nd: the accomplishments themselves.
      .mockResolvedValueOnce(mockJsonResponse(200, { preferred_unit_system: "imperial" }))
      .mockResolvedValueOnce(mockJsonResponse(200, prFixture));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetAccomplishmentsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({})) as typeof prFixture & { summary_lines: string[] };
    // strength_pr prior_best floors to nearest 5: 93.5 kg → 206.13 lb → floor5 = 205 lb
    expect(result.summary_lines[0]).toContain("previous best was 205 lb");
  });

  it("passes through the accomplishments array unchanged", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { preferred_unit_system: "metric" }))
      .mockResolvedValueOnce(mockJsonResponse(200, fixture));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetAccomplishmentsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({})) as typeof fixture & { summary_lines: string[] };
    expect(result.accomplishments).toEqual(fixture.accomplishments);
  });
});
