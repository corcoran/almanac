import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeAdminSetUserAdminTool } from "./admin-set-user-admin.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("admin_set_user_admin", () => {
  it("grants admin (sends is_admin: 1)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, { id: 2, is_admin: 1 }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAdminSetUserAdminTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({ user_id: 2, is_admin: true })) as {
      user: { id: number; is_admin: number };
    };
    expect(result.user.is_admin).toBe(1);
    expect(String(nthCall(fetchImpl, 0)[0])).toContain("/api/v1/admin/users/2");
    const init = nthCall(fetchImpl, 0)[1] as { method: string; body: string };
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ is_admin: 1 });
  });

  it("revokes admin (sends is_admin: 0)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, { id: 2, is_admin: 0 }));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAdminSetUserAdminTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await tool.handler({ user_id: 2, is_admin: false });
    const init = nthCall(fetchImpl, 0)[1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ is_admin: 0 });
  });
});
