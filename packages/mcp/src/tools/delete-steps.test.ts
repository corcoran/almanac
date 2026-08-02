import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { makeDeleteStepsTool } from "./delete-steps.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("delete_steps", () => {
  it("DELETEs /api/v1/step-logs/:id and returns {deleted, step_id}", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(204, ""));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeDeleteStepsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({ step_id: 42, confirm: true });

    expect(result).toEqual({ deleted: true, step_id: 42 });
    const url = nthCall(fetchImpl, 0)[0] as string;
    expect(url).toBe("http://x/api/v1/step-logs/42");
    const init = nthCall(fetchImpl, 0)[1] as RequestInit;
    expect(init.method).toBe("DELETE");
  });

  it("rejects calls without confirm: true at the schema level", () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeDeleteStepsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    // confirm must be the LITERAL true — Zod rejects undefined, false, "true".
    expect(tool.inputSchema.safeParse({ step_id: 42 }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ step_id: 42, confirm: false }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ step_id: 42, confirm: "true" }).success).toBe(false);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("advertises destructiveHint: true so clients prompt before invoking", () => {
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() });
    const tool = makeDeleteStepsTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.annotations?.readOnlyHint).toBe(false);
  });
});
