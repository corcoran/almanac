import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeUpdateUserProfileTool } from "./update-user-profile.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("update_user_profile", () => {
  it("PATCHes /api/v1/users/me with the provided fields and returns the updated user", async () => {
    const updated = {
      id: 1,
      name: "Jeff",
      dob: "1990-04-01",
      height_cm: 180,
      sex: "male",
      preferred_unit_system: "metric",
      created_at: "2026-01-01T00:00:00Z",
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, updated));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateUserProfileTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const patch = { height_cm: 180, preferred_unit_system: "metric" as const };
    const result = await tool.handler(patch);
    const r = result as { user: { id: number; height_cm: number; preferred_unit_system: string } };
    expect(r.user.id).toBe(1);
    expect(r.user.height_cm).toBe(180);
    expect(r.user.preferred_unit_system).toBe("metric");
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/users/me");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual(patch);
    expect(call[1].headers["idempotency-key"]).toBeUndefined();
  });

  it("propagates 422 from the API when a field value is invalid", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(422, {
        error: { code: "validation_failed", message: "height_cm must be positive" },
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateUserProfileTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ height_cm: -5 })).rejects.toThrow(/422/);
  });

  it("serializes explicit null to clear nullable fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, {
        id: 1,
        name: "Jeff",
        dob: null,
        height_cm: null,
        sex: null,
        preferred_unit_system: "metric",
        created_at: "2026-01-01T00:00:00.000Z",
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateUserProfileTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await tool.handler({ dob: null, height_cm: null });
    const body = JSON.parse(nthCall(fetchImpl, 0)[1].body);
    expect(body).toEqual({ dob: null, height_cm: null });
  });

  it("forwards activity_level to PATCH /api/v1/users/me and returns the updated user", async () => {
    const updated = {
      id: 1,
      name: "Jeff",
      dob: null,
      height_cm: null,
      sex: null,
      activity_level: "active",
      preferred_unit_system: "metric",
      created_at: "2026-01-01T00:00:00Z",
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, updated));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateUserProfileTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    const result = await tool.handler({ activity_level: "active" });
    const r = result as { user: { activity_level: string } };
    expect(r.user.activity_level).toBe("active");
    expect(JSON.parse(nthCall(fetchImpl, 0)[1].body)).toEqual({ activity_level: "active" });
  });

  it("forwards timezone to PATCH /api/v1/users/me", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, {
        id: 1,
        name: "Jeff",
        dob: null,
        height_cm: null,
        sex: null,
        preferred_unit_system: "metric",
        timezone: "America/Toronto",
        created_at: "2026-01-01T00:00:00Z",
      }),
    );
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdateUserProfileTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await tool.handler({ timezone: "America/Toronto" });
    expect(JSON.parse(nthCall(fetchImpl, 0)[1].body)).toEqual({ timezone: "America/Toronto" });
  });
});
