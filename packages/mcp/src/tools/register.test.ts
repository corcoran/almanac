import { at } from "@almanac/core/test-support";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClient } from "../client.js";
import { connectTestClient } from "../test-support/mcp-harness.js";
import { type Tool, type ToolDeps, ToolError } from "../tool.js";
import { makeUserTzResolver, registerOneTool } from "./register.js";

function deps(): ToolDeps {
  const api = new ApiClient({
    baseUrl: "http://x",
    // /api/v1/users/me -> tz resolver; everything else unused here.
    fetchImpl: vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ timezone: "America/Toronto" }),
    })) as unknown as typeof fetch,
  });
  return { api, currentUserId: async () => 1, currentToken: () => "alm_test" };
}

function build(tool: Tool<unknown>) {
  const server = new McpServer({ name: "t", version: "0.0.0" }, { capabilities: { tools: {} } });
  const d = deps();
  registerOneTool(server, tool, makeUserTzResolver(d).get);
  return server;
}

describe("registerOneTool", () => {
  it("stamps _meta.server_now and _meta.user_tz on a successful result", async () => {
    const tool: Tool<{ x: number }> = {
      name: "echo",
      description: "echo",
      inputSchema: z.object({ x: z.number() }),
      handler: async (input) => ({ got: input.x }),
    };
    const client = await connectTestClient(build(tool as Tool<unknown>));
    const res = (await client.callTool({ name: "echo", arguments: { x: 7 } })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(at(res.content, 0).text) as {
      got: number;
      _meta: { server_now: string; user_tz: string };
    };
    expect(payload.got).toBe(7);
    expect(payload._meta.user_tz).toBe("America/Toronto");
    expect(payload._meta.server_now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("passes a ToolError payload through as an isError text envelope (no _meta)", async () => {
    const tool: Tool<Record<string, never>> = {
      name: "boom",
      description: "boom",
      inputSchema: z.object({}),
      handler: async () => {
        throw new ToolError({ error: "tdee_unavailable", detail: "nope" });
      },
    };
    const client = await connectTestClient(build(tool as Tool<unknown>));
    const res = (await client.callTool({ name: "boom", arguments: {} })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    const payload = JSON.parse(at(res.content, 0).text) as Record<string, unknown>;
    expect(payload.error).toBe("tdee_unavailable");
    expect(payload._meta).toBeUndefined();
  });

  it("wraps a non-object handler result as { result, _meta }", async () => {
    const tool: Tool<Record<string, never>> = {
      name: "stringy",
      description: "stringy",
      inputSchema: z.object({}),
      handler: async () => "hello",
    };
    const client = await connectTestClient(build(tool as Tool<unknown>));
    const res = (await client.callTool({ name: "stringy", arguments: {} })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(at(res.content, 0).text) as {
      result: string;
      _meta: { server_now: string; user_tz: string };
    };
    expect(payload.result).toBe("hello");
    expect(payload._meta.user_tz).toBe("America/Toronto");
  });
});

function depsWithTimezones(timezones: readonly string[]) {
  let call = 0;
  const fetchImpl = vi.fn(async () => {
    const tz = timezones[Math.min(call, timezones.length - 1)] ?? "UTC";
    call += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ timezone: tz }),
    };
  }) as unknown as typeof fetch;
  const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
  const d: ToolDeps = { api, currentUserId: async () => 1, currentToken: () => "alm_test" };
  return { deps: d, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> };
}

describe("makeUserTzResolver", () => {
  it("caches across calls so every tool result does not re-fetch", async () => {
    const { deps: d, fetchImpl } = depsWithTimezones(["America/New_York"]);
    const resolver = makeUserTzResolver(d);
    expect(await resolver.get()).toBe("America/New_York");
    expect(await resolver.get()).toBe("America/New_York");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after invalidate() so a profile write is not stale", async () => {
    // Regression: the cache had NO expiry, so _meta.user_tz served the first
    // value for the whole process lifetime — a timezone change stayed stale
    // until the client reconnected.
    const { deps: d, fetchImpl } = depsWithTimezones(["UTC", "America/New_York"]);
    const resolver = makeUserTzResolver(d);
    expect(await resolver.get()).toBe("UTC");
    resolver.invalidate();
    expect(await resolver.get()).toBe("America/New_York");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to UTC when the profile fetch fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const d: ToolDeps = { api, currentUserId: async () => 1, currentToken: () => "alm_test" };
    expect(await makeUserTzResolver(d).get()).toBe("UTC");
  });
});
