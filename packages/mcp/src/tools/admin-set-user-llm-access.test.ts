import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeAdminSetUserLlmAccessTool } from "./admin-set-user-llm-access.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("admin_set_user_llm_access", () => {
  it("enables LLM access (sends llm_logging_enabled: 1)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 2, llm_logging_enabled: 1 }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAdminSetUserLlmAccessTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({ user_id: 2, enabled: true })) as {
      user: { id: number; llm_logging_enabled: number };
    };
    expect(result.user.llm_logging_enabled).toBe(1);
    expect(String(nthCall(fetchImpl, 0)[0])).toContain("/api/v1/admin/users/2");
    const init = nthCall(fetchImpl, 0)[1] as { method: string; body: string };
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ llm_logging_enabled: 1 });
  });

  it("disables LLM access (sends llm_logging_enabled: 0)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 2, llm_logging_enabled: 0 }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAdminSetUserLlmAccessTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await tool.handler({ user_id: 2, enabled: false });
    const init = nthCall(fetchImpl, 0)[1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ llm_logging_enabled: 0 });
  });
});
