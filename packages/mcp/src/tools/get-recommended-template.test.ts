import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetRecommendedTemplateTool } from "./get-recommended-template.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_recommended_template", () => {
  it("GETs /api/v1/signals/recommend-template and returns ranked recommendations", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, {
        recommendations: [
          {
            template_id: 20,
            template_name: "PULL",
            score: 2,
            confidence: "actionable",
            avg_recovery_hours: 96,
            reasoning: {
              prime_groups_hit: ["Back", "Biceps"],
              in_window_groups_hit: [],
              too_soon_groups_hit: [],
              neutral_groups_hit: [],
              overdue_groups_hit: [],
            },
          },
        ],
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetRecommendedTemplateTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const r = (await tool.handler({ top_n: 1 })) as {
      recommendations: Array<{ template_name: string }>;
    };
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0]?.template_name).toBe("PULL");
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/signals/recommend-template?top_n=1");
    expect(call[1].method).toBe("GET");
  });

  it("defaults top_n=1 when not passed", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, { recommendations: [] }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetRecommendedTemplateTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await tool.handler({});
    expect(nthCall(fetchImpl, 0)[0]).toContain("top_n=1");
  });
});
