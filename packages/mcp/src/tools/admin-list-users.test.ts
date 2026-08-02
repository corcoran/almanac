import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeAdminListUsersTool } from "./admin-list-users.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("admin_list_users", () => {
  it("GETs /api/v1/admin/users and returns the list", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, [
        { id: 1, email: "admin@x", is_admin: 1 },
        { id: 2, email: "user@x", is_admin: 0 },
      ]),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeAdminListUsersTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({})) as { users: Array<{ id: number }> };
    expect(result.users).toHaveLength(2);
    expect(result.users[0]?.id).toBe(1);
    expect(String(nthCall(fetchImpl, 0)[0])).toContain("/api/v1/admin/users");
    const init = nthCall(fetchImpl, 0)[1] as { method: string };
    expect(init.method).toBe("GET");
  });
});
