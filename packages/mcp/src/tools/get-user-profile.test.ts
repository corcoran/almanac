import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeGetUserProfileTool } from "./get-user-profile.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("get_user_profile", () => {
  it("GETs /api/v1/users/me and wraps the response under `user`", async () => {
    const user = {
      id: 1,
      name: "Jeff",
      dob: "1990-01-01",
      height_cm: 180,
      sex: "male",
      activity_level: "moderate",
      preferred_unit_system: "imperial",
      timezone: "America/Toronto",
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, user));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetUserProfileTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({});

    expect(result).toEqual({ user });
    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url).toBe("http://x/api/v1/users/me");
    const init = nthCall(fetchImpl, 0)[1] as RequestInit;
    expect(init.method).toBe("GET");
  });

  it("passes through about_me on the returned user", async () => {
    const user = {
      id: 1,
      name: "Jeff",
      preferred_unit_system: "imperial",
      timezone: "America/Toronto",
      about_me: "cyclist; trains 5x/week",
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, user));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeGetUserProfileTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = (await tool.handler({})) as { user: { about_me?: string } };

    expect(result.user.about_me).toBe("cyclist; trains 5x/week");
  });
});
