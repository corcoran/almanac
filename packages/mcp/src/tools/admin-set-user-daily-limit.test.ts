import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiHttpError } from "../client.js";
import { makeAdminSetUserDailyLimitTool } from "./admin-set-user-daily-limit.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("admin_set_user_daily_limit", () => {
  it("PATCHes the target user's daily limit and returns the user", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 2, llm_daily_token_limit: 30000 }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAdminSetUserDailyLimitTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({ user_id: 2, daily_token_limit: 30000 })) as {
      user: { id: number; llm_daily_token_limit: number };
    };
    expect(result.user.id).toBe(2);
    expect(result.user.llm_daily_token_limit).toBe(30000);
    expect(String(nthCall(fetchImpl, 0)[0])).toContain("/api/v1/admin/users/2");
    const init = nthCall(fetchImpl, 0)[1] as { method: string; body: string };
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ llm_daily_token_limit: 30000 });
  });

  it("sends null to clear the limit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 2, llm_daily_token_limit: null }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAdminSetUserDailyLimitTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await tool.handler({ user_id: 2, daily_token_limit: null });
    const init = nthCall(fetchImpl, 0)[1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ llm_daily_token_limit: null });
  });

  it("surfaces a 403 as a thrown ApiHttpError (route enforces admin)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(403, { error: { message: "forbidden" } }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAdminSetUserDailyLimitTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ user_id: 2, daily_token_limit: 30000 })).rejects.toBeInstanceOf(
      ApiHttpError,
    );
  });
});
