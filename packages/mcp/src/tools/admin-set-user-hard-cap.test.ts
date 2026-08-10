import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiHttpError } from "../client.js";
import { makeAdminSetUserHardCapTool } from "./admin-set-user-hard-cap.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("admin_set_user_hard_cap", () => {
  const deps = {
    api: new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() }),
    currentUserId: async () => 1,
    currentToken: () => "alm_test",
  };

  it("is named for the tier it sets", () => {
    expect(makeAdminSetUserHardCapTool(deps).name).toBe("admin_set_user_hard_cap");
  });

  it("says in its description that this tier does block, unlike the soft one", () => {
    const { description } = makeAdminSetUserHardCapTool(deps);
    expect(description).toMatch(/429|block/i);
    expect(description).toMatch(/lower|tighten|min/i);
  });

  it("PATCHes the per-user hard cap and returns the user", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 2, llm_daily_hard_cap: 20000 }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAdminSetUserHardCapTool({ ...deps, api });

    const result = (await tool.handler({ user_id: 2, hard_daily_token_cap: 20000 })) as {
      user: { id: number; llm_daily_hard_cap: number };
    };

    expect(result.user.llm_daily_hard_cap).toBe(20000);
    expect(String(nthCall(fetchImpl, 0)[0])).toContain("/api/v1/admin/users/2");
    const init = nthCall(fetchImpl, 0)[1] as { method: string; body: string };
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ llm_daily_hard_cap: 20000 });
  });

  it("sends null to clear the cap so the user rejoins the env ceiling", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 2, llm_daily_hard_cap: null }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAdminSetUserHardCapTool({ ...deps, api });

    await tool.handler({ user_id: 2, hard_daily_token_cap: null });

    const init = nthCall(fetchImpl, 0)[1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ llm_daily_hard_cap: null });
  });

  it("surfaces a 403 as a thrown ApiHttpError (route enforces admin)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(403, { error: { message: "forbidden" } }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAdminSetUserHardCapTool({ ...deps, api });

    await expect(tool.handler({ user_id: 2, hard_daily_token_cap: 20000 })).rejects.toBeInstanceOf(
      ApiHttpError,
    );
  });
});
