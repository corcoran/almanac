import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeBootstrapUserTool } from "./bootstrap-user.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("bootstrap_user", () => {
  it("POSTs /api/v1/users and returns id + name + timezone", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(201, {
        id: 1,
        name: "Jeff",
        dob: "1981-07-16",
        height_cm: 183,
        sex: "male",
        preferred_unit_system: "metric",
        timezone: "America/Toronto",
        created_at: "2026-05-14T08:00:00Z",
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeBootstrapUserTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({
      name: "Jeff",
      dob: "1981-07-16",
      height_cm: 183,
      sex: "male",
      timezone: "America/Toronto",
    })) as { id: number; name: string; timezone: string };
    expect(result.id).toBe(1);
    expect(result.name).toBe("Jeff");
    expect(result.timezone).toBe("America/Toronto");
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/users");
    expect(call[1].method).toBe("POST");
  });

  it("works with name only", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(201, {
        id: 1,
        name: "Anon",
        dob: null,
        height_cm: null,
        sex: null,
        preferred_unit_system: "metric",
        timezone: "UTC",
        created_at: "2026-05-14T08:00:00Z",
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeBootstrapUserTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = (await tool.handler({ name: "Anon" })) as { name: string };
    expect(result.name).toBe("Anon");
  });
});
