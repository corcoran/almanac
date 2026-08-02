import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetCalendarTool } from "./get-calendar.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_calendar", () => {
  it("GETs /api/v1/calendar with the month query param", async () => {
    const body = {
      month: "2026-05",
      tally: { total: 4, by_template: { "1": 2, "2": 2 } },
      past_sessions: [
        {
          date: "2026-05-18",
          workout_id: 42,
          template_id: 1,
          template_name: "PUSH A",
        },
      ],
      pill_segments: [
        {
          template_id: 1,
          template_name: "PUSH A",
          last_hit_at: "2026-05-18T17:00:00.000Z",
          segments: [
            { date: "2026-05-19", phase: "too_soon", is_proposed: false },
            { date: "2026-05-20", phase: "too_soon", is_proposed: false },
            { date: "2026-05-21", phase: "acceptable", is_proposed: false },
          ],
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, body));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetCalendarTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({ month: "2026-05" });

    expect(result).toEqual(body);
    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(new URL(url).pathname).toBe("/api/v1/calendar");
    expect(new URL(url).searchParams.get("month")).toBe("2026-05");
  });

  it("rejects a malformed month", () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetCalendarTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    // Zod validation lives in registerTools normally, but we can run it here
    // directly to confirm the regex is wired up.
    const parse = tool.inputSchema.safeParse({ month: "2026-5" });
    expect(parse.success).toBe(false);
  });
});
